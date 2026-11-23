import type { Clock } from "../clock.js";
import { AppError, isAppError } from "../errors/app-error.js";
import { createLockService } from "../lock/index.js";
import { loadProfile, methodFor, type Profile } from "../methods/index.js";
import { renderContextPacket, type ContextPacket } from "./context-packet.js";
import { createBudgetGuard } from "./budget.js";
import { addUsage, emptyUsage, type RunRecord, type StepRecord } from "./record.js";
import type {
  ExecutePipelineOptions,
  PipelineDefinition,
  PipelineEvent,
  RunCtx,
  StageRunner,
  StageSpec,
} from "./stage.js";
import { transition } from "./state.js";

export interface GatewayLike {
  run(
    role: string,
    req: { system: string; user: string; json?: boolean },
    opts: {
      runId: string;
      stage: string;
      budget: ReturnType<typeof createBudgetGuard>;
      signal: AbortSignal;
    },
  ): Promise<{
    text: string;
    usage: { input: number; cachedInput: number; output: number };
    cost: number | null;
  }>;
}

function normalizeOptions(
  opts?: ((rec: RunRecord) => Promise<void>) | ExecutePipelineOptions,
): ExecutePipelineOptions {
  if (!opts) return {};
  if (typeof opts === "function") return { onPersist: opts };
  return opts;
}

export async function executePipeline<
  Req,
  Res,
  State extends Record<string, unknown> = Record<string, unknown>,
>(
  def: PipelineDefinition<Req, Res, State>,
  record: RunRecord,
  ctx: RunCtx<Req, State>,
  gateway: GatewayLike,
  clock: Clock,
  signal: AbortSignal,
  onPersistOrOpts?: ((rec: RunRecord) => Promise<void>) | ExecutePipelineOptions,
): Promise<RunRecord> {
  const { onPersist, onEvent } = normalizeOptions(onPersistOrOpts);
  let current = record;
  const budget = createBudgetGuard(current.budget, current.usage);
  const completedMap = new Map<string, StepRecord>(
    current.steps.filter((s) => s.status === "done").map((s) => [s.id, s]),
  );

  // 确保上下文具备注入的 clock / lock / budget，避免业务层私自依赖系统时钟或锁
  const boundCtx: RunCtx<Req, State> = {
    ...ctx,
    clock: ctx.clock ?? clock,
    lock: ctx.lock ?? createLockService(clock),
    budget: ctx.budget ?? current.budget,
  };

  let profilePromise: Promise<Profile | undefined> | undefined;
  function resolveProfile(): Promise<Profile | undefined> {
    if (boundCtx.profile) return Promise.resolve(boundCtx.profile);
    if (!boundCtx.profileRoots) return Promise.resolve(undefined);
    if (!profilePromise) {
      profilePromise = loadProfile(
        boundCtx.target.mode,
        boundCtx.profileId ?? "default",
        boundCtx.profileRoots,
      );
    }
    return profilePromise;
  }

  // 串行化运行记录更新与磁盘落盘，根治 fanOut 并发竞态导致的步骤/用量丢更新
  let persistChain: Promise<void> = Promise.resolve();
  const commit = (mutate: (rec: RunRecord) => RunRecord): Promise<void> => {
    const task = persistChain.then(async () => {
      current = mutate(current);
      if (onPersist) await onPersist(current);
    });
    persistChain = task.catch(() => {});
    return task;
  };

  const emit = (event: Omit<PipelineEvent, "runId" | "at">) => {
    if (!onEvent) return;
    onEvent({ ...event, runId: current.id, at: clock.iso() });
  };

  async function runSingleStage<I, O>(
    stepId: string,
    spec: StageSpec<I, O, Req, State>,
    packet: ContextPacket,
  ): Promise<O> {
    const prev = completedMap.get(stepId);
    if (prev && prev.output !== undefined) {
      return prev.output as O;
    }

    const startedAt = clock.iso();
    emit({ type: "stage.start", stageId: stepId, title: spec.title, role: spec.role });
    const rendered = renderContextPacket(packet);

    let method: { text: string; hash: string; omitted: string[] } | undefined;
    if (spec.method) {
      const profile = await resolveProfile();
      if (profile) {
        const vars = spec.method.vars ? spec.method.vars(boundCtx) : undefined;
        method = methodFor(profile, spec.method.stage, vars);
      }
    }

    const systemPrompt = [rendered.system, method?.text].filter(Boolean).join("\n\n");
    const inputVal = await spec.input(boundCtx);
    const userPrompt = [
      rendered.user,
      typeof inputVal === "string" ? inputVal : JSON.stringify(inputVal),
      spec.shape,
    ]
      .filter(Boolean)
      .join("\n\n");

    const maxRetries = spec.retries ?? 1;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const answer = await gateway.run(
          spec.role,
          { system: systemPrompt, user: userPrompt, json: spec.format === "json" },
          { runId: current.id, stage: stepId, budget, signal },
        );
        const step: StepRecord = {
          id: stepId,
          role: spec.role,
          status: "failed",
          ...(method ? { methodHash: method.hash, omitted: method.omitted } : {}),
          usage: { ...answer.usage, cost: answer.cost },
          startedAt,
          finishedAt: clock.iso(),
        };
        await commit((rec) => ({
          ...rec,
          steps: [...rec.steps, step],
          usage: addUsage(rec.usage, step.usage),
          updated: clock.iso(),
        }));
        const parsed = spec.parse(answer.text);
        let finalValue = parsed;
        let notes: string[] | undefined;

        if (spec.accept) {
          const accepted = await spec.accept(parsed, boundCtx);
          if (
            typeof accepted === "object" &&
            accepted !== null &&
            "value" in accepted &&
            "notes" in accepted
          ) {
            finalValue = accepted.value;
            notes = accepted.notes;
          } else {
            finalValue = accepted as O;
          }
        }

        const completed: StepRecord = {
          ...step,
          status: "done",
          notes,
          output: finalValue,
          finishedAt: clock.iso(),
        };
        completedMap.set(stepId, completed);
        await commit((rec) => ({
          ...rec,
          steps: rec.steps.map((entry) => (entry === step ? completed : entry)),
          updated: clock.iso(),
        }));
        emit({ type: "stage.done", stageId: stepId, title: spec.title, role: spec.role });
        return finalValue;
      } catch (err) {
        lastErr = err;
        if (isAppError(err) && err.code === "model.output_invalid" && attempt < maxRetries) {
          continue;
        }
        emit({ type: "stage.failed", stageId: stepId, title: spec.title, role: spec.role });
        throw err;
      }
    }
    throw lastErr;
  }

  const runner: StageRunner<Req, State> = {
    signal,
    stage: (spec, packet) => runSingleStage(spec.id, spec, packet),
    fanOut: async (spec, packet) => {
      const count = spec.fanOut ? spec.fanOut.count(boundCtx) : 1;
      const tasks = Array.from({ length: count }, (_, idx) =>
        runSingleStage(`${spec.id}-${idx}`, spec, packet),
      );
      const results = await Promise.allSettled(tasks);
      await persistChain;
      return results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
    },
    local: async (id, fn) => {
      const prev = completedMap.get(id);
      if (prev && prev.output !== undefined) return prev.output as Awaited<ReturnType<typeof fn>>;
      const startedAt = clock.iso();
      emit({ type: "stage.start", stageId: id, role: "local" });
      try {
        const out = await fn();
        const step: StepRecord = {
          id,
          role: "local",
          status: "done",
          output: out,
          usage: emptyUsage(),
          startedAt,
          finishedAt: clock.iso(),
        };
        completedMap.set(id, step);
        await commit((rec) => ({
          ...rec,
          steps: [...rec.steps, step],
          updated: clock.iso(),
        }));
        emit({ type: "stage.done", stageId: id, role: "local" });
        return out;
      } catch (err) {
        emit({ type: "stage.failed", stageId: id, role: "local" });
        throw err;
      }
    },
  };

  try {
    const res = await def.run(runner, boundCtx);
    await def.deliver(res, boundCtx);
    await commit((rec) => transition(rec, "awaiting-author", "deliver", clock.iso()));
    return current;
  } catch (err) {
    if (isAppError(err) && err.spec.pause) {
      await commit((rec) => transition(rec, "paused", err.spec.pause ?? "error", clock.iso()));
      return current;
    }
    if (signal.aborted) {
      const targetState = signal.reason === "cancelled" ? "cancelled" : "paused";
      await commit((rec) => transition(rec, targetState, "author-stop", clock.iso()));
      return current;
    }
    await commit((rec) => transition(rec, "failed", "error", clock.iso()));
    if (isAppError(err)) throw err;
    throw new AppError("internal", err instanceof Error ? err.message : String(err));
  }
}
