import type { Clock } from "../clock.js";
import { AppError } from "../errors/app-error.js";
import type { BudgetGuard } from "../pipeline/budget.js";
import type { Role } from "../tool/roles.js";
import { createEstimator } from "./estimate.js";
import type { ModelAnswer, ModelPort, ModelRequest } from "./port.js";
import { withRetry } from "./retry.js";
import type { UsageTracker } from "./usage.js";
import { createWatchdog } from "./watchdog.js";

export interface RoleBinding {
  connection: string;
  model: string;
  thinking?: "off" | "low" | "high";
  temperature?: number;
  price?: { inputPer1M: number; outputPer1M: number };
}

export interface GatewayConfig {
  globalConcurrency: number;
  perRunConcurrency: number;
  roles: Record<string, RoleBinding>;
  usage?: UsageTracker;
  requireExplicitBinding?: boolean;
}

interface Waiter {
  runId: string;
  signal: AbortSignal;
  resolve: () => void;
  reject: (err: unknown) => void;
}

export interface ModelGateway {
  run(
    role: Role,
    req: Omit<ModelRequest, "connection" | "model">,
    opts: {
      runId: string;
      stage: string;
      budget: BudgetGuard;
      signal: AbortSignal;
      onDelta?: (delta: string) => void;
    },
  ): Promise<ModelAnswer>;
  session<T>(
    role: Role,
    fn: (port: ModelPort) => Promise<T>,
    opts: { scope: string; signal?: AbortSignal },
  ): Promise<T>;
  stats(): { active: number; queued: number };
}

export function createModelGateway(
  port: ModelPort,
  config: GatewayConfig,
  clock: Clock,
): ModelGateway {
  let active = 0;
  const activeByRun = new Map<string, number>();
  const queue: Waiter[] = [];
  const estimator = createEstimator();

  const tryDispatch = () => {
    while (active < config.globalConcurrency && queue.length > 0) {
      const idx = queue.findIndex((w) => {
        if (w.signal.aborted) return false;
        const per = activeByRun.get(w.runId) ?? 0;
        return per < config.perRunConcurrency;
      });
      if (idx === -1) break;
      const [waiter] = queue.splice(idx, 1);
      active += 1;
      activeByRun.set(waiter.runId, (activeByRun.get(waiter.runId) ?? 0) + 1);
      waiter.resolve();
    }
  };

  const acquire = (runId: string, signal: AbortSignal): Promise<() => void> => {
    if (signal.aborted) {
      return Promise.reject(new AppError("run.stopped", "请求已中止"));
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        runId,
        signal,
        resolve: () => {
          signal.removeEventListener("abort", onAbort);
          resolve(() => {
            active = Math.max(0, active - 1);
            const cur = activeByRun.get(runId) ?? 1;
            if (cur <= 1) activeByRun.delete(runId);
            else activeByRun.set(runId, cur - 1);
            tryDispatch();
          });
        },
        reject,
      };
      const onAbort = () => {
        const i = queue.indexOf(waiter);
        if (i !== -1) queue.splice(i, 1);
        reject(new AppError("run.stopped", "请求已中止"));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      queue.push(waiter);
      tryDispatch();
    });
  };

  const resolveBinding = (role: string): RoleBinding => {
    const found = config.roles[role] ?? config.roles.writer;
    if (found) return found;
    if (config.requireExplicitBinding) {
      throw new AppError("model.auth", `角色 ${role} 尚未配置模型连接`, { role });
    }
    return { connection: "default", model: "default" };
  };

  const computeCost = (binding: RoleBinding, answer: ModelAnswer): number | null => {
    if (answer.cost !== null) return answer.cost;
    if (!binding.price) return null;
    return (
      (answer.usage.input / 1_000_000) * binding.price.inputPer1M +
      (answer.usage.output / 1_000_000) * binding.price.outputPer1M
    );
  };

  return {
    async run(role, req, opts) {
      const binding = resolveBinding(role);
      const key = `${binding.connection}:${binding.model}`;
      const est = estimator.estimate(key, `${req.system}\n${req.user}`);
      const reservation = opts.budget.reserve(est);
      let release: (() => void) | undefined;
      try {
        release = await acquire(opts.runId, opts.signal);
        const answer = await withRetry(
          async () => {
            const wd = createWatchdog(opts.signal);
            try {
              return await port.stream(
                {
                  ...req,
                  connection: binding.connection,
                  model: binding.model,
                  thinking: req.thinking ?? binding.thinking,
                  temperature: req.temperature ?? binding.temperature,
                  sessionId: req.sessionId ?? opts.runId,
                  cacheRetention: req.cacheRetention ?? "short",
                },
                wd.signal,
                (event) => {
                  wd.poke();
                  if (event.type === "delta" && event.text) {
                    opts.onDelta?.(event.text);
                  }
                },
              );
            } finally {
              wd.dispose();
            }
          },
          clock,
          opts.signal,
        );
        const cost = computeCost(binding, answer);
        estimator.calibrate(key, est, answer.usage.input);
        reservation.settle({ ...answer.usage, cost });
        config.usage?.record({
          at: clock.iso(),
          runId: opts.runId,
          stage: opts.stage,
          role,
          connection: binding.connection,
          model: binding.model,
          input: answer.usage.input,
          cachedInput: answer.usage.cachedInput,
          output: answer.usage.output,
          cost,
        });
        return { ...answer, cost };
      } finally {
        reservation.release();
        release?.();
      }
    },

    async session(role, fn, opts) {
      const signal = opts.signal ?? new AbortController().signal;
      const release = await acquire(`session:${opts.scope}`, signal);
      try {
        const watchedPort: ModelPort = {
          stream: (req, portSignal, onDelta) => {
            const wd = createWatchdog(portSignal);
            return port
              .stream(req, wd.signal, (delta) => {
                wd.poke();
                onDelta?.(delta);
              })
              .then((answer) => {
                config.usage?.record({
                  at: clock.iso(),
                  stage: `session:${opts.scope}`,
                  role,
                  connection: req.connection,
                  model: req.model,
                  input: answer.usage.input,
                  cachedInput: answer.usage.cachedInput,
                  output: answer.usage.output,
                  cost: answer.cost,
                });
                return answer;
              })
              .finally(() => wd.dispose());
          },
        };
        return await fn(watchedPort);
      } finally {
        release();
      }
    },

    stats() {
      return { active, queued: queue.length };
    },
  };
}
