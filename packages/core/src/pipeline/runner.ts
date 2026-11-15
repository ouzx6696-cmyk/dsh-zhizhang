import type { Clock } from "../clock.js";
import { AppError, isAppError } from "../errors/app-error.js";
import { loadProfile, methodFor, type Profile } from "../methods/index.js";
import { renderContextPacket, type ContextPacket } from "./context-packet.js";
import { createBudgetGuard } from "./budget.js";
import { addUsage, emptyUsage, type RunRecord, type StepRecord } from "./record.js";
import type { PipelineDefinition, RunCtx, StageRunner, StageSpec } from "./stage.js";
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

export async function executePipeline<Req, Res>(
  def: PipelineDefinition<Req, Res>,
  record: RunRecord,
  ctx: RunCtx,
  gateway: GatewayLike,
  clock: Clock,
  signal: AbortSignal,
  onPersist?: (rec: RunRecord) => Promise<void>,
): Promise<RunRecord> {
  let current = record;
  const budget = createBudgetGuard(current.budget, current.usage);
  const completedMap = new Map<string, StepRecord>(
    current.steps.filter((s) => s.status === "done").map((s) => [s.id, s]),
  );

  let profilePromise: Promise<Profile | undefined> | undefined;
  function resolveProfile(): Promise<Profile | undefined> {
    if (ctx.profile) return Promise.resolve(ctx.profile);
    if (!ctx.profileRoots) return Promise.resolve(undefined);
    if (!profilePromise) {
      profilePromise = loadProfile(ctx.target.mode, ctx.profileId ?? "default", ctx.profileRoots);
    }
    return profilePromise;
  }

  const persist = async () => {
    if (onPersist) await onPersist(current);
  };

  async function runSingleStage<I, O>(
    stepId: string,
    spec: StageSpec<I, O>,
    packet: ContextPacket,
  ): Promise<O> {
    const prev = completedMap.get(stepId);
    if (prev && prev.output !== undefined) {
      return prev.output as O;
    }

    const startedAt = clock.iso();
    const rendered = renderContextPacket(packet);

    let method: { text: string; hash: string; omitted: string[] } | undefined;
    if (spec.method) {
      const profile = await resolveProfile();
      if (profile) {
        method = methodFor(profile, spec.method.stage);
      }
    }

    const systemPrompt = [rendered.system, method?.text].filter(Boolean).join("\n\n");
    const inputVal = await spec.input(ctx);
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
        current = {
          ...current,
          steps: [...current.steps, step],
          usage: addUsage(current.usage, step.usage),
          updated: clock.iso(),
        };
        await persist();
        const parsed = spec.parse(answer.text);
        let finalValue = parsed;
        let notes: string[] | undefined;

        if (spec.accept) {
          const accepted = await spec.accept(parsed, ctx);
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
        current = {
          ...current,
          steps: current.steps.map((entry) => (entry === step ? completed : entry)),
          updated: clock.iso(),
        };
        completedMap.set(stepId, completed);
        await persist();
        return finalValue;
      } catch (err) {
        lastErr = err;
        if (isAppError(err) && err.code === "model.output_invalid" && attempt < maxRetries) {
          continue;
        }
        throw err;
      }
    }
    throw lastErr;
  }

  const runner: StageRunner = {
    signal,
    stage: (spec, packet) => runSingleStage(spec.id, spec, packet),
    fanOut: async (spec, packet) => {
      const count = spec.fanOut ? spec.fanOut.count(ctx) : 1;
      const tasks = Array.from({ length: count }, (_, idx) =>
        runSingleStage(`${spec.id}-${idx}`, spec, packet),
      );
      const results = await Promise.allSettled(tasks);
      return results.map((result) => {
        if (result.status === "rejected") throw result.reason;
        return result.value;
      });
    },
    local: async (id, fn) => {
      const prev = completedMap.get(id);
      if (prev && prev.output !== undefined) return prev.output as Awaited<ReturnType<typeof fn>>;
      const startedAt = clock.iso();
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
      current = {
        ...current,
        steps: [...current.steps, step],
        updated: clock.iso(),
      };
      completedMap.set(id, step);
      await persist();
      return out;
    },
  };

  try {
    const res = await def.run(runner, ctx);
    await def.deliver(res, ctx);
    current = transition(current, "awaiting-author", "deliver", clock.iso());
    await persist();
    return current;
  } catch (err) {
    if (isAppError(err) && err.spec.pause) {
      current = transition(current, "paused", err.spec.pause, clock.iso());
      await persist();
      return current;
    }
    if (signal.aborted) {
      current = transition(current, "paused", "author-stop", clock.iso());
      await persist();
      return current;
    }
    current = transition(current, "failed", "error", clock.iso());
    await persist();
    if (isAppError(err)) throw err;
    throw new AppError("internal", err instanceof Error ? err.message : String(err));
  }
}
