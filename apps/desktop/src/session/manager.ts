import { WorkflowService } from "../workflow/service";
import { DEFAULT_HISTORY_LIMIT } from "../history-options";
import { shouldProactivelyCompact } from "../context-settings";
import path from "node:path";
import { rootIdentity } from "../../../../packages/core/src/identity";
import { mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { atomicWrite, exists, sha256 } from "../../../../packages/core/src/fsx";
import { errorText } from "../../../../packages/core/src/errors";
import { WORKFLOW_COPY } from "../../../../packages/ui/src/copy";
import type { Focus, Target } from "../context";
import type { DesktopEvent, WriterMessage } from "../renderer-contracts";
import type { ModelSettings } from "../models";
import type { AgentSession, SessionManager } from "./pi-adapter";
import { createSession, sessionFilePath } from "./create";
import { notifyAuthor, sendPrompt } from "./delivery";
import {
  conversations as listConversations,
  newConversation as startNewConversation,
  view as viewHistory,
} from "./history";
import type {
  AuthorAction,
  HistoryCache,
  SessionEntry,
  SessionExtras,
  SessionOptions,
} from "./types";

export class Sessions {
  projectedHistory = new WeakMap<
    SessionManager,
    { leaf: string | null; limit: number; messages: WriterMessage[]; total: number }
  >();
  readonly workflows: WorkflowService = new WorkflowService(this);
  reconfiguring = false;
  compactions = new Set<string>();
  preparations = new Map<symbol, { target: Target; focus: Focus; generation: number }>();
  generations = new Map<string, number>();
  historyCache: HistoryCache = new Map();
  sessions = new Map<string, SessionEntry>();
  opening = new Map<string, Promise<AgentSession>>();
  children = new Map<AgentSession, AgentSession>();

  constructor(
    private setup: {
      home: string;
      python: string | undefined;
      settings: () => ModelSettings;
      emit: (event: DesktopEvent) => void;
      confirm: (text: string, signal?: AbortSignal) => Promise<boolean>;
      options: SessionOptions;
      created: (previous: Target, next: Target) => Promise<void>;
      extras: SessionExtras;
    },
  ) {}
  get home() {
    return this.setup.home;
  }
  get python() {
    return this.setup.python;
  }
  get settings() {
    return this.setup.settings;
  }
  get emit() {
    return this.setup.emit;
  }
  get confirm() {
    return this.setup.confirm;
  }
  get options() {
    return this.setup.options;
  }
  get created() {
    return this.setup.created;
  }
  get extras() {
    return this.setup.extras;
  }
  same(a: Target, b: Target) {
    return this.key(a) === this.key(b);
  }
  isRunning(target: Target): boolean {
    const key = this.key(target);
    return (
      this.workflows.busy(target) ||
      this.compactions.has(key) ||
      this.preparing(target) ||
      this.opening.has(key) ||
      this.sessions.get(key)?.session.isIdle === false
    );
  }
  hasPending() {
    return this.preparations.size > 0 || this.opening.size > 0 || this.workflows.rows().length > 0;
  }

  /** key() runs on every publish; the realpath behind rootIdentity is resolved once per target. */
  private keys = new Map<string, string>();
  key(target: Target) {
    const raw = [target.mode, target.root, target.article ?? "", target.work ?? ""].join("\0");
    let value = this.keys.get(raw);
    if (value === undefined) {
      value = sha256(
        JSON.stringify({
          mode: target.mode,
          root: rootIdentity(target.root),
          ...(target.article ? { article: target.article } : {}),
          ...(target.work ? { work: target.work } : {}),
        }),
      ).slice(0, 24);
      // A missing root resolves without realpath; remember it only once it exists.
      if (existsSync(target.root)) {
        if (this.keys.size >= 256) this.keys.clear();
        this.keys.set(raw, value);
      }
    }
    return value;
  }

  async directory(target: Target) {
    return path.join(this.home, "sessions", this.key(target));
  }

  async open(
    target: Target,
    editor = false,
    planner = false,
    onCreated?: (work: string) => Promise<void>,
    onSaved?: (tool: string, output: string) => void,
  ): Promise<AgentSession> {
    if (this.reconfiguring) throw new Error("正在更新设置，请稍后打开会话");
    if (editor || planner)
      return createSession(this, target, editor ? "editor" : "planner", onCreated, onSaved);
    const key = this.key(target);
    const existing = this.sessions.get(key);
    if (existing) return existing.session;
    let opening = this.opening.get(key);
    if (!opening) {
      opening = createSession(this, target, "writer").finally(() => this.opening.delete(key));
      this.opening.set(key, opening);
    }
    return opening;
  }

  async send(target: Target, text: string, focus: Focus = {}) {
    if (this.workflows.busy(target)) throw new Error("流水线正在处理此作品，请先暂停后再调整要求");
    await this.rotateForNewChapter(target, focus);
    const result = await sendPrompt(this, target, text, focus);
    this.recordChapter(target, focus);
    return result;
  }

  /** 章级会话（fanqie.session.perChapter，默认关）：写手任务跨到新章时前章正文/章纲/根基/连续性
   * 都由交接简报从文件带入，旧对话上下文不再需要，先开新对话再发送。只在会话空闲时轮换；
   * 忙碌（排队/压缩/准备中/更新设置）时保持原行为，让消息照常排队。 */
  private async rotateForNewChapter(target: Target, focus: Focus) {
    if (
      this.reconfiguring ||
      target.mode !== "fanqie" ||
      this.options.fanqie?.session?.perChapter !== true ||
      !focus.chapter
    )
      return;
    const key = this.key(target),
      entry = this.sessions.get(key);
    if (!entry || entry.lastChapter === focus.chapter) return;
    if (
      !entry.session.isIdle ||
      entry.session.pendingMessageCount ||
      this.compactions.has(key) ||
      this.preparing(target)
    )
      return;
    await this.newConversation(target);
  }

  /** 记录该会话最近一次接受任务的章节，供章级会话判定跨章；任务被取消未接受时不记。 */
  private recordChapter(target: Target, focus: Focus) {
    if (target.mode !== "fanqie" || !focus.chapter) return;
    const entry = this.sessions.get(this.key(target));
    if (entry) entry.lastChapter = focus.chapter;
  }

  async notify(target: Target, value: AuthorAction) {
    await notifyAuthor(this, target, value);
    if (value.operation === "/chapter/finalize" && value.chapter && this.extras.engine?.().guided) {
      try {
        // A run the author can still continue or adopt keeps the work's pointer, and its basis
        // includes the continuity ledger: the ledger waits in the queue instead of displacing it.
        if ((await this.workflows.recordFinal(target, value.chapter)) === "queued")
          this.emit({ target, error: WORKFLOW_COPY.ledgerQueued });
      } catch (error) {
        // allow-catch: 定稿已经成功，记账失败独立提示，不把已完成定稿显示为失败。
        this.emit({ target, error: "定稿已保存，自动记账未启动：" + errorText(error) });
      }
    }
  }

  async conversations(target: Target) {
    return listConversations(this, target);
  }

  async newConversation(target: Target) {
    return startNewConversation(this, target);
  }

  async view(target: Target, limit = DEFAULT_HISTORY_LIMIT, archive?: number) {
    return viewHistory(this, target, limit, archive);
  }

  async attachCreated(entry: SessionEntry, work: string) {
    const previous = { ...entry.target },
      next = { ...previous, ...(previous.mode === "toutiao" ? { article: work } : { work }) };
    const key = this.key(next),
      dir = path.join(this.home, "sessions", key);
    if (this.sessions.has(key)) return;
    if (await exists(path.join(dir, "current"))) return;
    await mkdir(dir, { recursive: true });
    await atomicWrite(path.join(dir, "current"), sessionFilePath(entry.session.sessionManager));
    await rm(path.join(this.home, "sessions", this.key(previous), "current"), {
      force: true,
    });
    Object.assign(entry.target, next);
    this.sessions.delete(this.key(previous));
    this.sessions.set(key, entry);
    await this.created(previous, next);
  }

  running(): NonNullable<DesktopEvent["running"]> {
    return [
      ...[...this.sessions.values()]
        .filter(
          (entry) =>
            !entry.session.isIdle ||
            this.preparing(entry.target) ||
            this.compactions.has(this.key(entry.target)),
        )
        .map((entry) => ({
          target: entry.target,
          focus: entry.focus,
          phase:
            (entry.phase || "任务处理中…") +
            (entry.session.pendingMessageCount
              ? `（另有 ${entry.session.pendingMessageCount} 条排队，停止会一并取消）`
              : ""),
          task: entry.task,
        })),
      ...this.workflows.rows(),
    ];
  }

  preparing(target: Target) {
    return [...this.preparations.values()].some(
      (p) =>
        this.key(p.target) === this.key(target) &&
        p.generation === (this.generations.get(this.key(target)) || 0),
    );
  }

  release(target: Target) {
    const key = this.key(target),
      entry = this.sessions.get(key);
    if (!entry || (entry.session.isIdle && !this.children.has(entry.session))) {
      this.generations.set(key, (this.generations.get(key) || 0) + 1);
      entry?.session.dispose();
      this.sessions.delete(key);
    }
  }

  async compact(target: Target, instructions: string) {
    if (this.reconfiguring) throw new Error("正在更新设置，请稍后压缩上下文");
    const key = this.key(target),
      generation = this.generations.get(key) || 0;
    if (this.isRunning(target)) throw new Error("请先等待当前任务结束或停止任务，再压缩上下文");
    this.compactions.add(key);
    try {
      const history = await this.view(target);
      if (history.total === 0) throw new Error("当前历史较短或没有对话，暂无可压缩内容");
      const session = await this.open(target);
      if ((this.generations.get(key) || 0) !== generation) throw new Error("压缩已取消");
      if (!session.isIdle || session.pendingMessageCount) throw new Error("当前会话尚未空闲");
      return await session.compact(
        "保留作者限制、已确定事实、完成与待办事项、文件和章节标识、已读方法与来源。摘要不代替最新版本依据。\n" +
          instructions,
      );
    } finally {
      this.compactions.delete(key);
      this.emit({ running: this.running() });
    }
  }

  /** 主动压缩（session.proactiveCompact，默认关）：写手任务结算空闲后上下文达窗口 75% 即整理，
   * 赶在 PI 按 triggerPercent（默认 80%）的自动压缩之前；与手动压缩同一条 compact 路径，
   * 埋点 trigger 记 manual。 */
  async proactiveCompact(target: Target) {
    if (this.options[target.mode]?.session?.proactiveCompact !== true) return;
    const key = this.key(target),
      entry = this.sessions.get(key);
    if (!entry || !entry.session.isIdle || entry.session.pendingMessageCount) return;
    if (this.compactions.has(key) || this.preparing(target)) return;
    if (!shouldProactivelyCompact(entry.session.getContextUsage())) return;
    const generation = this.generations.get(key) || 0;
    try {
      await this.compact(target, "");
    } catch (error) {
      // compact 读档期间作者停止任务或排入新消息会取消本次压缩，下一次结算会重新评估，不算失败
      const superseded =
        (this.generations.get(key) || 0) !== generation ||
        this.sessions.get(key) !== entry ||
        !entry.session.isIdle ||
        entry.session.pendingMessageCount > 0;
      if (!superseded) this.emit({ target, error: "自动压缩上下文失败：" + errorText(error) });
    }
  }

  async stop(target: Target) {
    const key = this.key(target);
    // attachCreated 会把会话键从根迁到文章/作品键：精确键落空时按 mode+root 兜底，停止才不会落空
    const entry =
      this.sessions.get(key) ??
      [...this.sessions.values()].find(
        (item) =>
          item.target.mode === target.mode &&
          rootIdentity(item.target.root) === rootIdentity(target.root),
      );
    const actualKey = entry ? this.key(entry.target) : key;
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
    if (actualKey !== key)
      this.generations.set(actualKey, (this.generations.get(actualKey) || 0) + 1);
    if (this.opening.has(key)) await this.opening.get(key);
    const session = entry?.session;
    session?.clearQueue();
    await Promise.all([
      this.workflows.stop(!target.work && !target.article && entry ? entry.target : target),
      session ? this.children.get(session)?.abort() : undefined,
      session?.abort(),
    ]);
  }

  async dispose() {
    await this.workflows.dispose();
    for (const p of this.preparations.values()) {
      const key = this.key(p.target);
      this.generations.set(key, (this.generations.get(key) || 0) + 1);
    }
    await Promise.allSettled(this.opening.values());
    for (const session of [
      ...this.children.values(),
      ...[...this.sessions.values()].map((entry) => entry.session),
    ]) {
      session.clearQueue();
      await session.abort();
      session.dispose();
    }
    this.sessions.clear();
    this.historyCache.clear();
    this.preparations.clear();
  }
}
