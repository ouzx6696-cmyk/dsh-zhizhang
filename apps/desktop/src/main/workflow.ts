/**
 * WorkflowService：每个目标单活、运行记录落盘、暂停/停止/恢复/重试、待作者决定、进度事件发布。
 * kind 从 ModeModule.pipelines 查表；模型调用全部经 ModelGateway（GatewayLike）。
 */
import { randomUUID } from "node:crypto";
import { createSerialRunner, type LockService } from "@zhizhang/core/lock";
import type { Clock } from "@zhizhang/core/clock";
import { AppError, classify } from "@zhizhang/core/errors";
import type { ProfileRoots } from "@zhizhang/core/methods";
import {
  executePipeline,
  transition,
  type BudgetConfig,
  type GatewayLike,
  type PipelineDefinition,
  type RunCtx,
  type RunRecord,
} from "@zhizhang/core/pipeline";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import type { ChangeScope, DesktopEvent } from "../shared/events.js";
import type {
  Mode,
  RunDetail,
  RunRef,
  RunSummary,
  RunningRow,
  Target,
  WorkflowAction,
  WorkflowDecision,
} from "../shared/views.js";
import { ModeRegistry } from "./modes.js";
import { summarizeRun, targetOfRun, withError, type RunStore } from "./services/runs.js";

export interface WorkflowDeps {
  clock: Clock;
  locks?: LockService;
  runs: RunStore;
  gateway(): GatewayLike;
  budget(): BudgetConfig;
  profileRoots(mode: Mode): ProfileRoots;
  profileId(target: Target): Promise<string>;
  libraryRoot?(): string;
  emit(event: DesktopEvent): void;
  onRunningChange?(): void;
  /** 组合根补齐运行环境相关的请求字段（例如随包脚本与方案目录）。 */
  prepareRequest?(kind: string, request: unknown): unknown;
}

interface ActiveRun {
  target: Target;
  runId: string;
  kind: string;
  since: string;
  stage?: string;
  controller: AbortController;
  promise: Promise<RunDetail>;
}

const SCOPE_BY_KIND: Record<string, ChangeScope> = {
  "fanqie.book": "rows",
  "fanqie.chapter": "chapter",
  "fanqie.review": "chapter",
  "fanqie.revise": "chapter",
  "fanqie.ledger": "bible",
  "fanqie.health": "bible",
  "library.dissect": "library",
  "toutiao.article": "article",
};

const keyOf = (target: { path: string }) => target.path;

export function createWorkflowService(deps: WorkflowDeps) {
  const active = new Map<string, ActiveRun>();
  const serial = createSerialRunner();

  async function contextFor(
    def: PipelineDefinition<unknown, unknown>,
    target: Target,
    request: unknown,
    runId?: string,
  ): Promise<RunCtx> {
    const profileId = await deps.profileId(target);
    const profileRoots = deps.profileRoots(target.mode);
    const budget = deps.budget();
    const ctx = await def.context(target, request, {
      workspaceRoot: target.path,
      profileId,
      profileRoots,
      clock: deps.clock,
      lock: deps.locks,
      budget,
    });
    return {
      ...ctx,
      runId: runId ?? randomUUID(),
      profileId,
      profileRoots,
      libraryRoot: deps.libraryRoot?.(),
      clock: ctx.clock ?? deps.clock,
      lock: ctx.lock ?? deps.locks,
      budget: ctx.budget ?? budget,
    };
  }

  function emitRun(detail: RunDetail): void {
    deps.emit({ kind: "run", target: targetOfRun(detail), run: summarizeRun(detail) });
  }

  function emitRunning(): void {
    deps.emit({ kind: "running", rows: rows() });
    deps.onRunningChange?.();
  }

  function rows(): RunningRow[] {
    return [...active.values()].map((run) => ({
      target: run.target,
      source: "pipeline",
      runId: run.runId,
      kind: run.kind,
      ...(run.stage ? { stage: run.stage } : {}),
      since: run.since,
    }));
  }

  function launch(
    def: PipelineDefinition<unknown, unknown>,
    record: RunRecord,
    ctx: RunCtx,
    target: Target,
  ): ActiveRun {
    const controller = new AbortController();
    const run: ActiveRun = {
      target,
      runId: record.id,
      kind: record.kind,
      since: deps.clock.iso(),
      controller,
      promise: Promise.resolve(withError(record)),
    };
    run.promise = (async (): Promise<RunDetail> => {
      let latest: RunRecord = record;
      try {
        latest = await executePipeline(
          def,
          record,
          ctx,
          deps.gateway(),
          deps.clock,
          controller.signal,
          {
            onPersist: async (rec) => {
              latest = rec;
              run.stage = rec.steps[rec.steps.length - 1]?.id;
              const detail = withError(rec);
              await deps.runs.save(detail);
              emitRun(detail);
            },
            onEvent: (event) => {
              if (event.type === "stage.start") {
                run.stage = event.stageId;
                emitRunning();
              }
            },
          },
        );
        const detail = withError(latest);
        await deps.runs.save(detail);
        emitRun(detail);
        if (latest.state === "awaiting-author") {
          deps.emit({
            kind: "workspace.changed",
            target,
            revision: `${latest.id}:${latest.updated}`,
            scope: SCOPE_BY_KIND[latest.kind] ?? "rows",
          });
        }
        return detail;
      } catch (err) {
        const appErr = classify(err);
        const failed =
          latest.state === "failed"
            ? latest
            : transition(latest, "failed", "error", deps.clock.iso());
        const detail = withError(failed, { code: appErr.code, message: appErr.message });
        await deps.runs.save(detail);
        emitRun(detail);
        return detail;
      } finally {
        if (active.get(keyOf(target)) === run) active.delete(keyOf(target));
        emitRunning();
      }
    })();
    active.set(keyOf(target), run);
    emitRunning();
    return run;
  }

  async function load(ref: RunRef): Promise<RunDetail> {
    const detail = await deps.runs.get(ref.target, ref.runId);
    if (!detail)
      throw new AppError("input.not_found", `未找到运行记录：${ref.runId}`, { runId: ref.runId });
    return detail;
  }

  function assertIdle(target: Target): void {
    const busy = active.get(keyOf(target));
    if (busy) {
      throw new AppError("gate.denied", "当前作品已有运行中的流水线", {
        runId: busy.runId,
        kind: busy.kind,
      });
    }
  }

  async function startRun(target: Target, kind: string, rawRequest: unknown): Promise<ActiveRun> {
    return serial(keyOf(target), async () => {
      const def = ModeRegistry.pipeline(target.mode, kind);
      assertIdle(target);
      const request = def.request(
        deps.prepareRequest ? deps.prepareRequest(kind, rawRequest) : rawRequest,
        "$request",
      );
      const ctx = await contextFor(def, target, request);
      const now = deps.clock.iso();
      const record: RunRecord = {
        format: FORMAT_VERSION,
        id: ctx.runId,
        kind,
        target,
        request,
        state: "running",
        stateHistory: [{ to: "running", reason: "start", at: now }],
        steps: [],
        usage: { input: 0, cachedInput: 0, output: 0, cost: 0 },
        budget: deps.budget(),
        created: now,
        updated: now,
      };
      await deps.runs.save(withError(record));
      emitRun(withError(record));
      return launch(def, record, ctx, target);
    });
  }

  return {
    async start(target: Target, kind: string, request: unknown): Promise<RunRef> {
      const run = await startRun(target, kind, request);
      return { runId: run.runId, target };
    },

    /** 发起并等待结束（命令式调用与测试用）。 */
    async startAndWait(target: Target, kind: string, request: unknown): Promise<RunDetail> {
      const run = await startRun(target, kind, request);
      return run.promise;
    },

    async control(ref: RunRef, action: WorkflowAction): Promise<RunSummary> {
      const running = active.get(keyOf(ref.target));
      if (action === "pause" || action === "stop") {
        if (running && running.runId === ref.runId) {
          running.controller.abort(action === "stop" ? "cancelled" : "paused");
          return summarizeRun(await running.promise);
        }
        return summarizeRun(await load(ref));
      }
      return serial(keyOf(ref.target), async () => {
        assertIdle(ref.target);
        const detail = await load(ref);
        if (detail.state !== "paused" && detail.state !== "failed") {
          throw new AppError(
            "run.invalid_transition",
            `运行处于 ${detail.state}，不能${action === "retry" ? "重试" : "恢复"}`,
            {
              state: detail.state,
            },
          );
        }
        const def = ModeRegistry.pipeline(ref.target.mode, detail.kind);
        const ctx = await contextFor(def, ref.target, detail.request, detail.id);
        const { error: _error, ...record } = detail;
        const resumed = transition(
          record,
          "running",
          action === "retry" ? "retry" : "resume",
          deps.clock.iso(),
        );
        const next: RunRecord = { ...resumed, budget: deps.budget() };
        await deps.runs.save(withError(next));
        emitRun(withError(next));
        launch(def, next, ctx, ref.target);
        return summarizeRun(withError(next));
      });
    },

    async decide(ref: RunRef, decision: WorkflowDecision): Promise<RunSummary> {
      return serial(keyOf(ref.target), async () => {
        assertIdle(ref.target);
        const detail = await load(ref);
        const { error: _error, ...record } = detail;
        const next = transition(
          record,
          decision === "apply" ? "applied" : "discarded",
          decision,
          deps.clock.iso(),
        );
        if (decision === "apply") {
          const def = ModeRegistry.pipeline(ref.target.mode, detail.kind);
          if (def.apply) {
            const ctx = await contextFor(def, ref.target, detail.request, detail.id);
            ctx.state = Object.fromEntries(
              record.steps
                .filter((step) => step.status === "done")
                .map((step) => [step.id, step.output]),
            );
            await def.apply(record, decision, ctx);
          }
        }
        const saved = withError(next);
        let saveErr: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await deps.runs.save(saved);
            saveErr = undefined;
            break;
          } catch (err) {
            saveErr = err;
            if (attempt < 2) await deps.clock.sleep((attempt + 1) * 50);
          }
        }
        if (saveErr) throw saveErr;
        emitRun(saved);
        deps.emit({
          kind: "workspace.changed",
          target: ref.target,
          revision: `${next.id}:${next.updated}`,
          scope: SCOPE_BY_KIND[next.kind] ?? "rows",
        });
        return summarizeRun(saved);
      });
    },

    async get(ref: RunRef): Promise<RunDetail | null> {
      return (await deps.runs.get(ref.target, ref.runId)) ?? null;
    },

    async history(target: Target): Promise<RunSummary[]> {
      return (await deps.runs.list(target)).map(summarizeRun);
    },

    running: rows,

    /** 启动时把上次进程遗留的 running 记录标记为中断（可恢复）。 */
    async recoverInterrupted(): Promise<RunSummary[]> {
      const out: RunSummary[] = [];
      for (const detail of await deps.runs.listAll()) {
        if (detail.state !== "running" || active.has(keyOf(detail.target))) continue;
        const { error: _error, ...record } = detail;
        const paused = withError(transition(record, "paused", "interrupted", deps.clock.iso()));
        await deps.runs.save(paused);
        out.push(summarizeRun(paused));
      }
      return out;
    },

    /** 中断的运行由作者放弃：标记为 cancelled。 */
    async cancel(ref: RunRef): Promise<RunSummary> {
      return serial(keyOf(ref.target), async () => {
        assertIdle(ref.target);
        const detail = await load(ref);
        const { error: _error, ...record } = detail;
        const next = withError(transition(record, "cancelled", "cancel", deps.clock.iso()));
        await deps.runs.save(next);
        emitRun(next);
        return summarizeRun(next);
      });
    },

    async stopAll(): Promise<void> {
      const runs = [...active.values()];
      for (const run of runs) run.controller.abort();
      await Promise.all(runs.map((run) => run.promise));
    },
  };
}

export type WorkflowService = ReturnType<typeof createWorkflowService>;
