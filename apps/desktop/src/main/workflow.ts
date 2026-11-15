import type { Clock } from "@zhizhang/core";
import { AppError } from "@zhizhang/core/errors";
import { executePipeline, transition, type GatewayLike, type RunRecord } from "@zhizhang/core/pipeline";
import { ModeRegistry } from "./modes.js";
import type { DesktopEvent } from "../shared/events.js";
import type { RunRef, Target } from "../shared/ipc.js";

export function createWorkflowService(deps: {
  gateway: GatewayLike;
  clock: Clock;
  onEvent?: (event: DesktopEvent) => void;
}) {
  const activeRuns = new Map<string, AbortController>();
  const records = new Map<string, RunRecord>();

  function emitRun(target: Target, rec: RunRecord) {
    deps.onEvent?.({
      kind: "run",
      target,
      record: { id: rec.id, state: rec.state, kind: rec.kind },
    });
  }

  async function runPipeline(
    target: Target,
    kind: string,
    initial: RunRecord,
    ctx: Awaited<ReturnType<ReturnType<typeof ModeRegistry.get>["pipelines"][never]["context"]>>,
  ): Promise<RunRecord> {
    const mod = ModeRegistry.get(target.mode);
    const def = mod.pipelines[kind as keyof typeof mod.pipelines];
    if (!def) {
      throw new AppError("input.invalid", `Unknown pipeline kind: ${kind}`, { kind });
    }
    const targetKey = `${target.mode}:${target.path}`;
    const ac = new AbortController();
    activeRuns.set(targetKey, ac);
    records.set(initial.id, initial);
    emitRun(target, initial);
    try {
      const finalRec = await executePipeline(
        def,
        initial,
        ctx,
        deps.gateway,
        deps.clock,
        ac.signal,
        async (rec) => {
          records.set(rec.id, rec);
          emitRun(target, rec);
        },
      );
      records.set(finalRec.id, finalRec);
      emitRun(target, finalRec);
      return finalRec;
    } finally {
      activeRuns.delete(targetKey);
    }
  }

  return {
    async start(target: Target, kind: string, request: unknown): Promise<RunRecord> {
      const targetKey = `${target.mode}:${target.path}`;
      if (activeRuns.has(targetKey)) {
        throw new AppError("storage.locked", "当前目标已有运行中的流水线任务");
      }
      const mod = ModeRegistry.get(target.mode);
      const def = mod.pipelines[kind as keyof typeof mod.pipelines];
      if (!def) {
        throw new AppError("input.invalid", `Unknown pipeline kind: ${kind}`, { kind });
      }
      const parsedReq = def.request(request, "$request");
      const ctx = await def.context(target, parsedReq, {
        workspaceRoot: target.path,
        profileId: mod.profiles.defaultId,
      });
      const now = deps.clock.iso();
      const initial: RunRecord = {
        format: "zhizhang/1.3",
        id: ctx.runId,
        kind,
        target,
        request: parsedReq,
        state: "running",
        stateHistory: [{ to: "running", reason: "start", at: now }],
        steps: [],
        usage: { input: 0, cachedInput: 0, output: 0, cost: 0 },
        budget: { inputBudget: 24000, runBudget: 1200000, moneyCap: null },
        created: now,
        updated: now,
      };
      return runPipeline(target, kind, initial, ctx);
    },

    async control(ref: RunRef, action: "pause" | "resume" | "stop" | "retry"): Promise<void> {
      const rec = records.get(ref.runId);
      if (!rec) throw new AppError("input.not_found", `Run not found: ${ref.runId}`);
      const targetKey = `${rec.target.mode}:${rec.target.path}`;

      if (action === "pause" || action === "stop") {
        activeRuns.get(targetKey)?.abort();
        if (rec.state === "running") {
          const next = transition(
            rec,
            "paused",
            action === "stop" ? "author-stop" : "author-pause",
            deps.clock.iso(),
          );
          records.set(ref.runId, next);
          emitRun(ref.target, next);
        }
        return;
      }

      if (action === "resume" || action === "retry") {
        if (activeRuns.has(targetKey)) {
          throw new AppError("storage.locked", "当前目标已有运行中的流水线任务");
        }
        const mod = ModeRegistry.get(ref.target.mode);
        const def = mod.pipelines[rec.kind as keyof typeof mod.pipelines];
        if (!def) {
          throw new AppError("input.invalid", `Unknown pipeline kind: ${rec.kind}`, { kind: rec.kind });
        }
        const ctx = await def.context(ref.target, rec.request, {
          workspaceRoot: ref.target.path,
          profileId: mod.profiles.defaultId,
        });
        const next = transition(rec, "running", `author-${action}`, deps.clock.iso());
        void runPipeline(ref.target, rec.kind, next, ctx);
      }
    },

    stop(runId: string): void {
      const rec = records.get(runId);
      if (!rec) throw new AppError("input.not_found", `Run not found: ${runId}`);
      const targetKey = `${rec.target.mode}:${rec.target.path}`;
      activeRuns.get(targetKey)?.abort();
      if (rec.state === "running") {
        const next = transition(rec, "paused", "author-stop", deps.clock.iso());
        records.set(runId, next);
        emitRun(rec.target, next);
      }
    },

    get(runId: string): RunRecord | undefined {
      return records.get(runId);
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
