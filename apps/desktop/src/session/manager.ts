import path from "node:path";
import { rootIdentity } from "../../../../packages/core/src/identity";
import { createHash } from "node:crypto";
import { access, mkdir, rm, readdir, readFile } from "node:fs/promises";
import { atomicWrite } from "../../../../packages/core/src/fsx";
import type { Focus, Target } from "../context";
import type { DesktopEvent } from "../renderer-contracts";
import type { ModelSettings } from "../models";
import type { AgentSession, SessionManager } from "./pi-adapter";
import { createSession } from "./create";
import { notifyAuthor, sendPrompt } from "./delivery";
import {
  conversations as listConversations,
  newConversation as startNewConversation,
  view as viewHistory,
} from "./history";
import { taskPrompt } from "./prompt";
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
    { leaf: string | null; limit: number; messages: unknown[]; total: number }
  >();
  preparations = new Map<symbol, { target: Target; focus: Focus; generation: number }>();
  generations = new Map<string, number>();
  historyCache: HistoryCache = new Map();
  sessions = new Map<string, SessionEntry>();
  opening = new Map<string, Promise<AgentSession>>();
  children = new Map<AgentSession, AgentSession>();

  constructor(
    public home: string,
    public python: string,
    public settings: () => ModelSettings,
    public emit: (event: DesktopEvent) => void,
    public confirm: (text: string, signal?: AbortSignal) => Promise<boolean>,
    public options: SessionOptions = {},
    public created: (previous: Target, next: Target) => Promise<void> = async () => {},
    public extras: SessionExtras = {},
  ) {}

  hasPending() {
    return this.preparations.size > 0 || this.opening.size > 0;
  }

  key(target: Target) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          mode: target.mode,
          root: rootIdentity(target.root),
          ...(target.article ? { article: target.article } : {}),
          ...(target.work ? { work: target.work } : {}),
        }),
      )
      .digest("hex")
      .slice(0, 24);
  }

  async directory(target: Target) {
    const root = path.join(this.home, "sessions"),
      current = path.join(root, this.key(target));
    if (target.mode !== "fanqie") return current;
    try {
      await access(current);
      return current;
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    const dirs = await readdir(root).catch((error: any) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    for (const dir of dirs) {
      const marker = await readFile(path.join(root, dir, "current"), "utf8").catch((error: any) => {
        if (error.code === "ENOENT" || error.code === "ENOTDIR") return "";
        throw error;
      });
      if (!marker) continue;
      const first = (await readFile(marker, "utf8")).split("\n", 1)[0];
      const header = JSON.parse(first);
      if (!header.cwd || rootIdentity(header.cwd) !== rootIdentity(target.root)) continue;
      const oldKey = createHash("sha256")
        .update(
          JSON.stringify({
            mode: target.mode,
            root: path.resolve(header.cwd),
            ...(target.work ? { work: target.work } : {}),
          }),
        )
        .digest("hex")
        .slice(0, 24);
      if (dir === oldKey) return path.join(root, dir);
    }
    return current;
  }

  async open(
    target: Target,
    editor = false,
    planner = false,
    onCreated?: (work: string) => Promise<void>,
    onSaved?: (tool: string, output: string) => void,
  ): Promise<AgentSession> {
    if (editor || planner)
      return createSession(this, target, editor ? "editor" : "planner", onCreated, onSaved);
    const key = this.key(target);
    if (this.sessions.has(key)) return this.sessions.get(key)!.session;
    if (!this.opening.has(key))
      this.opening.set(
        key,
        createSession(this, target, "writer").finally(() => this.opening.delete(key)),
      );
    return this.opening.get(key)!;
  }

  async send(target: Target, text: string, focus: Focus = {}) {
    return sendPrompt(this, target, text, focus);
  }

  async notify(target: Target, value: AuthorAction) {
    return notifyAuthor(this, target, value);
  }

  async conversations(target: Target) {
    return listConversations(this, target);
  }

  async newConversation(target: Target) {
    return startNewConversation(this, target);
  }

  async view(target: Target, limit = 80, archive?: number) {
    return viewHistory(this, target, limit, archive);
  }

  async handoffPreview(target: Target, focus: Focus = {}) {
    return taskPrompt(this, target, "交接", focus);
  }

  async attachCreated(entry: SessionEntry, work: string) {
    const previous = { ...entry.target },
      next = { ...previous, ...(previous.mode === "toutiao" ? { article: work } : { work }) };
    const key = this.key(next),
      dir = path.join(this.home, "sessions", key);
    if (this.sessions.has(key)) return;
    const exists = await access(path.join(dir, "current")).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (exists) return;
    await mkdir(dir, { recursive: true });
    await atomicWrite(path.join(dir, "current"), entry.session.sessionManager.getSessionFile()!);
    await rm(path.join(this.home, "sessions", this.key(previous), "current"), {
      force: true,
    });
    Object.assign(entry.target, next);
    this.sessions.delete(this.key(previous));
    this.sessions.set(key, entry);
    await this.created(previous, next);
  }

  running() {
    return [...this.sessions.values()]
      .filter((entry) => !entry.session.isIdle || this.preparing(entry.target))
      .map((entry) => ({
        target: entry.target,
        focus: entry.focus,
        phase:
          (entry.phase || "任务处理中…") +
          (entry.session.pendingMessageCount
            ? `（另有 ${entry.session.pendingMessageCount} 条排队，停止会一并取消）`
            : ""),
        task: entry.task,
      }));
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

  async stop(target: Target) {
    const key = this.key(target);
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
    if (this.opening.has(key)) await this.opening.get(key);
    const session = this.sessions.get(key)?.session;
    session?.clearQueue();
    if (session) await Promise.all([this.children.get(session)?.abort(), session.abort()]);
  }

  async dispose() {
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
