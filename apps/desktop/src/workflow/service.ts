import { applyPlan, applyArticle } from "./apply";
import path from "node:path";
import { recoverDelivery } from "./recovery";
import { readdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { atomicWrite, readText, sha256, shortId } from "../../../../packages/core/src/fsx";
import { assertWorkspaceWritable } from "../../../../packages/core/src/workspace-lock";
import {
  WorkflowJournal,
  WorkflowPause,
  DEFAULT_ENGINE,
  type WorkflowRecord,
  type WorkflowRequest,
} from "../../../../packages/core/src/workflow";
import { resolveFanqieWork } from "../main/storage";
import { readWorkMeta } from "../../../../packages/fanqie/src/engine/storage/work-meta";
import { withResourceLock } from "../../../../packages/fanqie/src/engine/storage/process-lock";
import { workflowContext } from "./context";
import { WorkflowRun } from "./run";
import { chapterPipeline } from "./chapter";
import { articlePipeline } from "./article";
import { bookPipeline } from "./book";
import { ledgerPipeline, readContinuity, decideFact, parseContinuity } from "./continuity";
import { record } from "./schema";
import { StageError } from "./stage-model";
import { errorText } from "../../../../packages/core/src/errors";
import type { Sessions } from "../session/manager";
import type { Target } from "../context";
import type { AgentSession } from "../session/pi-adapter";

/**
 * How a run that threw ends: the author's stop and a stage pause keep it resumable, anything else
 * fails it. A stage whose journal write also failed throws both; the stage error comes first.
 */
function stopOutcome(
  thrown: unknown,
  aborted: boolean,
): Pick<WorkflowRecord, "state" | "error" | "reason"> {
  if (aborted) return { state: "paused", reason: "stopped", error: "任务已暂停，阶段进度保留" };
  const cause = thrown instanceof AggregateError ? thrown.errors[0] : thrown;
  if (cause instanceof WorkflowPause)
    return { state: "paused", reason: cause.reason, error: errorText(thrown) };
  const reason = cause instanceof StageError && cause.kind === "auth" ? "auth" : undefined;
  return { state: "failed", reason, error: errorText(thrown) };
}
interface Active {
  controller: AbortController;
  target: Target;
  record?: WorkflowRecord;
  promise: Promise<void>;
}
/** One active writer per target; stage generation is pure until a version-checked delivery. */
export class WorkflowService {
  private active = new Map<string, Active>();
  constructor(private host: Sessions) {}
  private directory(target: Target) {
    return path.join(this.host.home, "workflows", this.host.key(target));
  }
  private pointer(target: Target) {
    return path.join(this.directory(target), "current");
  }
  private file(target: Target, id: string) {
    if (!/^run-[a-f0-9]+$/.test(id)) throw new Error("流水线记录编号无效");
    return path.join(this.directory(target), id + ".json");
  }
  busy(target: Target) {
    return this.active.has(this.host.key(target));
  }
  rows() {
    return [...this.active.values()].map((value) => ({
      target: value.target,
      focus: { chapter: value.record?.request.chapter },
      phase:
        value.record?.steps.findLast((step) => step.status === "running")?.title ?? "准备流水线…",
    }));
  }
  async status(target: Target) {
    const id = await readText(this.pointer(target));
    const state = id ? await WorkflowJournal.read(this.file(target, id)) : undefined;
    if (state?.state === "running" && !this.busy(target)) {
      const journal = await WorkflowJournal.open(
        this.file(target, state.id),
        state.request,
        state.sourceHash,
        state.basis,
        (value) => this.publish(target, value),
      );
      journal.record.state = "paused";
      journal.record.reason = "interrupted";
      journal.record.error = "上次运行已中断，可从已保存阶段恢复";
      await journal.save();
      return journal.record;
    }
    return state;
  }
  private publish(target: Target, state: WorkflowRecord) {
    const active = this.active.get(this.host.key(target));
    if (active) active.record = state;
    this.host.emit({ target, workflow: state, running: this.host.running() });
  }
  async start(target: Target, request: WorkflowRequest, resume = false, parent?: AgentSession) {
    if (this.host.reconfiguring) throw new Error("正在更新设置，请稍后开始流水线");
    if (
      this.busy(target) ||
      (this.host.isRunning(target) &&
        (!parent || this.host.sessions.get(this.host.key(target))?.session !== parent))
    )
      throw new Error("此作品已有任务，请先停止或等待完成");
    if ((target.mode === "toutiao") !== (request.kind === "article"))
      throw new Error("流水线与当前作品模式不匹配");
    const key = this.host.key(target),
      controller = new AbortController();
    const active: Active = { target: { ...target }, controller, promise: Promise.resolve() };
    this.active.set(key, active);
    try {
      await assertWorkspaceWritable(target.root);
      controller.signal.throwIfAborted();
      const previous = resume ? await this.status(target) : undefined;
      if (resume && !previous) throw new Error("没有可恢复的流水线记录");
      if (previous?.state === "awaiting-author") {
        this.active.delete(key);
        return previous;
      }
      if (previous?.steps.some((step) => step.id === "delivery" && step.status === "complete")) {
        const journal = await WorkflowJournal.open(
          this.file(target, previous.id),
          previous.request,
          previous.sourceHash,
          previous.basis,
          (value) => this.publish(target, value),
        );
        journal.record.state = "awaiting-author";
        delete journal.record.error;
        delete journal.record.reason;
        await journal.save();
        this.active.delete(key);
        return journal.record;
      }
      const input = previous?.request ?? request;
      const context = await workflowContext(this.host, target, input);
      let sourceHash = context.sourceHash;
      if (previous && previous.sourceHash !== sourceHash) {
        await recoverDelivery(this.host, target, previous, context);
        sourceHash = previous.sourceHash;
      }
      controller.signal.throwIfAborted();
      const id = previous?.id ?? shortId("run");
      const journal = await WorkflowJournal.open(
        this.file(target, id),
        input,
        sourceHash,
        previous?.basis ?? context.basis,
        (state) => this.publish(target, state),
      );
      active.record = journal.record;
      await atomicWrite(this.pointer(target), id);
      const settings = this.host.extras.engine?.() ?? DEFAULT_ENGINE;
      const run = new WorkflowRun(
        this.host,
        journal,
        context,
        { ...settings, grade: input.grade },
        controller.signal,
      );
      active.promise = (async () => {
        try {
          if (input.kind === "book") await bookPipeline(run);
          else if (input.kind === "chapter") await chapterPipeline(run, target);
          else if (input.kind === "ledger") await ledgerPipeline(run, target);
          else await articlePipeline(run, target);
          journal.record.state = "awaiting-author";
          delete journal.record.error;
          delete journal.record.reason;
        } catch (error) {
          Object.assign(journal.record, stopOutcome(error, controller.signal.aborted));
        } finally {
          try {
            await journal.save();
          } finally {
            this.active.delete(key);
            this.host.emit({ running: this.host.running(), target, refresh: true });
          }
        }
      })();
      // Keep persistence errors visible while the UI starts polling the journal.
      void active.promise.catch((error) =>
        this.host.emit({ target, error: error instanceof Error ? error.message : String(error) }),
      );
      return structuredClone(journal.record);
    } catch (error) {
      this.active.delete(key);
      throw error;
    }
  }
  async history(target: Target) {
    const dir = this.directory(target),
      rows: WorkflowRecord[] = [];
    try {
      for (const name of await readdir(dir))
        if (/^run-[a-f0-9]+\.json$/.test(name)) {
          const value = await WorkflowJournal.read(path.join(dir, name));
          if (value) rows.push(value);
        }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
    return rows.sort((a, b) => b.created.localeCompare(a.created));
  }
  async stop(target: Target) {
    const active = this.active.get(this.host.key(target));
    active?.controller.abort();
    await active?.promise;
  }
  async dispose() {
    for (const active of this.active.values()) active.controller.abort();
    await Promise.all([...this.active.values()].map((row) => row.promise));
  }
  async continuity(target: Target) {
    return readContinuity(await resolveFanqieWork(this.host.options, target));
  }
  async decide(target: Target, id: string, accept: boolean) {
    await assertWorkspaceWritable(target.root);
    if (this.host.isRunning(target)) throw new Error("请先等待当前任务结束");
    const result = await decideFact(await resolveFanqieWork(this.host.options, target), id, accept);
    this.host.emit({ target, refresh: true });
    return result;
  }
  async migrate(target: Target) {
    await assertWorkspaceWritable(target.root);
    if (this.host.isRunning(target)) throw new Error("请先等待当前任务结束");
    if (
      !(await this.host.confirm(
        "将备份作品元数据，并把旧根基中的已发生、读者已知与伏笔转成待确认条目，不自动认定为新事实。是否继续？",
      ))
    )
      throw new Error("作者取消了迁移");
    if (this.host.isRunning(target)) throw new Error("此作品已开始新任务，请稍后迁移");
    const dir = await resolveFanqieWork(this.host.options, target);
    return withResourceLock(dir, async () => {
      const meta = await readWorkMeta(dir),
        state = await readContinuity(dir);
      const backup = path.join(
        dir,
        "writer-migration-backups",
        sha256(JSON.stringify(meta)).slice(0, 24) + ".json",
      );
      if ((await readText(backup)) === undefined)
        await atomicWrite(backup, await readFile(path.join(dir, "meta.json"), "utf8"));
      for (const [kind, source] of [
        ["thread", meta.foundation.threads],
        ["knowledge", meta.foundation.readerKnowledge],
        ["timeline", meta.foundation.happened],
      ] as const)
        for (const line of source
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)) {
          const id = sha256(kind + line).slice(0, 24);
          if (
            !state.pending.some((row) => row.id === id) &&
            !state.facts.some((row) => row.subject === line.slice(0, 80) && row.value === line)
          )
            state.pending.push({
              id,
              kind,
              subject: line.slice(0, 80),
              value: line,
              quote: line,
              chapter: "legacy",
              bodyHash: sha256(line),
              reason: "旧自由文本迁移，尚未确认人物、时间及证据",
            });
        }
      await atomicWrite(
        path.join(dir, "writer-continuity.json"),
        JSON.stringify(parseContinuity(state), null, 2),
      );
      return { backup, state };
    });
  }
  async apply(target: Target) {
    await assertWorkspaceWritable(target.root);
    if (this.host.isRunning(target)) throw new Error("请先等待当前任务结束");
    const state = await this.status(target);
    if (
      !state ||
      state.state !== "awaiting-author" ||
      !["book", "article"].includes(state.request.kind)
    )
      throw new Error("当前没有可采用的完整方案");
    const delivery = state.steps.find(
      (step) => step.id === "delivery" && step.status === "complete",
    );
    if (!delivery) throw new Error("方案交付不存在");
    if (state.steps.some((step) => step.id === "author-application" && step.status === "complete"))
      return state;
    if (
      !(await this.host.confirm(
        "将采用报告中的规划或文章立项卡与标题，原数据会先备份；已有章节不会被覆盖。是否继续？",
      ))
    )
      throw new Error("作者取消了采用方案");
    if (this.host.isRunning(target)) throw new Error("此作品已开始另一任务，请稍后采用方案");
    const journal = await WorkflowJournal.open(
      this.file(target, state.id),
      state.request,
      state.sourceHash,
      state.basis,
      (value) => this.publish(target, value),
    );
    try {
      await journal.step(
        "author-application",
        "作者已采用方案",
        record,
        async () => ({
          value:
            state.request.kind === "book"
              ? await applyPlan(this.host, target, state, record(delivery.output))
              : await applyArticle(this.host, target, state, record(delivery.output), journal),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: null },
        }),
        new AbortController().signal,
        0,
      );
    } finally {
      journal.record.state = "awaiting-author";
      await journal.save();
    }
    this.host.emit({ target, refresh: true });
    return journal.record;
  }
}
