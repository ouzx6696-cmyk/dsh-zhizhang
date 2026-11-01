import path from "node:path";
import { createHash } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
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
  preparations = new Set<symbol>();
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
          root: path.resolve(target.root),
          ...(target.work ? { work: target.work } : {}),
        }),
      )
      .digest("hex")
      .slice(0, 24);
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
      next = { ...previous, work };
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
    await atomicWrite(
      path.join(dir, "current"),
      entry.session.sessionManager.getSessionFile()!,
    );
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
      .filter((entry) => !entry.session.isIdle)
      .map((entry) => ({
        target: entry.target,
        focus: entry.focus,
        phase: entry.phase || "任务处理中…",
        task: entry.task,
      }));
  }

  release(target: Target) {
    const key = this.key(target),
      entry = this.sessions.get(key);
    if (entry?.session.isIdle && !this.children.has(entry.session)) {
      entry.session.dispose();
      this.sessions.delete(key);
    }
  }

  async stop(target: Target) {
    const key = this.key(target);
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
    if (this.opening.has(key)) await this.opening.get(key);
    const session = this.sessions.get(key)?.session;
    if (session)
      await Promise.all([this.children.get(session)?.abort(), session.abort()]);
  }

  async dispose() {
    await Promise.allSettled(this.opening.values());
    for (const session of [
      ...this.children.values(),
      ...[...this.sessions.values()].map((entry) => entry.session),
    ]) {
      await session.abort();
      session.dispose();
    }
    this.sessions.clear();
    this.historyCache.clear();
    this.generations.clear();
  }
}
