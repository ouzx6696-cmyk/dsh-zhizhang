/**
 * 助手会话管理：每个目标一个当前对话；一轮回复经 gateway.session("assistant") 占并发位，
 * 具备看门狗 + 瞬态重试 + 溢出自动压缩恢复 + 思考链流式推送 + 提示词缓存统计。
 */
import { randomBytes } from "node:crypto";
import { AppError } from "@zhizhang/core/errors";
import { createSerialRunner } from "@zhizhang/core/lock";
import type { SessionEvent } from "../shared/events.js";
import type {
  CompactResult,
  ContextUsageView,
  ConversationItem,
  RunningRow,
  SessionSend,
  SessionView,
  Target,
} from "../shared/views.js";
import { compactConversation } from "./compact.js";
import { contextTokens, decorateMessage, toChatMessages } from "./projection.js";
import { systemPrompt, userPrompt } from "./prompt.js";
import {
  runSessionTurn,
  type SessionDeps,
  type TargetState,
  type TurnRunnerHost,
} from "./turn-runner.js";

export { toChatMessages } from "./projection.js";
export type { AssistantBinding, SessionDeps } from "./turn-runner.js";

const DEFAULT_VIEW_LIMIT = 80;
const MAX_CACHED_STATES = 16;

const keyOf = (target: Target) => `${target.mode}:${target.path}`;

export function createSessionManager(deps: SessionDeps) {
  const states = new Map<string, TargetState>();
  const serial = createSerialRunner();
  let idCounter = 0;
  const nextId = (prefix: string) => {
    idCounter += 1;
    return `${prefix}${deps.clock.now().toString(36)}${idCounter.toString(36)}${randomBytes(2).toString("hex")}`;
  };

  function evictIdleStates(): void {
    if (states.size <= MAX_CACHED_STATES) return;
    for (const [k, s] of states) {
      if (states.size <= MAX_CACHED_STATES) break;
      if (!s.busy) states.delete(k);
    }
  }

  async function stateFor(target: Target): Promise<TargetState> {
    const key = keyOf(target);
    const hit = states.get(key);
    if (hit) {
      states.delete(key);
      states.set(key, hit);
      return hit;
    }
    const conversation = await deps.store.current(target);
    const state: TargetState = {
      target,
      conversation,
      busy: false,
      stream: "",
      thinkingStream: "",
      since: deps.clock.iso(),
    };
    states.set(key, state);
    evictIdleStates();
    return state;
  }

  function emit(state: TargetState, event: SessionEvent): void {
    deps.emit({
      kind: "session",
      target: state.target,
      conversationId: state.conversation.id,
      event,
    });
  }

  function setBusy(state: TargetState, busy: boolean): void {
    state.busy = busy;
    if (busy) state.since = deps.clock.iso();
    emit(state, { type: "busy", busy });
    deps.onBusyChange?.();
  }

  function compactThreshold(window: number): number {
    const settings = deps.context();
    const byPercent = Math.floor((window * settings.triggerPercent) / 100);
    return settings.budget > 0 ? Math.min(byPercent, settings.budget) : byPercent;
  }

  async function buildSystem(state: TargetState): Promise<string> {
    return systemPrompt({
      target: state.target,
      title: await deps.title(state.target),
      preferences: deps.preferences(),
      readonly: deps.readonly(),
    });
  }

  async function runCompact(
    state: TargetState,
    system: string,
    instructions?: string,
    signal?: AbortSignal,
  ): Promise<CompactResult> {
    return compactConversation(
      {
        clock: deps.clock,
        store: deps.store,
        gateway: deps.gateway,
        port: deps.port,
        binding: deps.binding,
        context: deps.context,
        nextId,
        emit: (event) => emit(state, event),
      },
      state.conversation,
      keyOf(state.target),
      system,
      instructions,
      signal,
    );
  }

  const runnerHost: TurnRunnerHost = {
    deps,
    keyOf,
    nextId,
    emit,
    setBusy,
    compactThreshold,
    buildSystem,
    runCompact,
  };

  const runTurn = (state: TargetState, send: SessionSend, signal: AbortSignal) =>
    runSessionTurn(runnerHost, state, send, signal);

  return {
    async view(
      target: Target,
      options: { conversationId?: string; limit?: number } = {},
    ): Promise<SessionView> {
      return serial(keyOf(target), async () => {
        const state = await stateFor(target);
        if (options.conversationId && options.conversationId !== state.conversation.id) {
          if (state.busy) throw new AppError("gate.denied", "助手正在回复，稍后再切换对话");
          state.conversation = await deps.store.select(target, options.conversationId);
        }
        const all = toChatMessages(state.conversation.messages).map((m) =>
          decorateMessage(state.target, m),
        );
        const limit = options.limit ?? DEFAULT_VIEW_LIMIT;
        return {
          conversationId: state.conversation.id,
          messages: all.slice(-limit),
          total: all.length,
          busy: state.busy,
          stream: state.stream,
          ...(state.thinkingStream ? { thinkingStream: state.thinkingStream } : {}),
          ...(state.task ? { task: { ...state.task } } : {}),
        };
      });
    },

    async send(target: Target, send: SessionSend): Promise<{ conversationId: string }> {
      return serial(keyOf(target), async () => {
        const text = send.text.trim();
        if (!text) throw new AppError("input.invalid", "消息不能为空", { field: "text" });
        const state = await stateFor(target);
        if (state.busy)
          throw new AppError("gate.denied", "助手正在回复，请稍候或先停止", { busy: true });
        deps.binding();
        const conv = state.conversation;
        if (!conv.title) conv.title = text.slice(0, 24);
        conv.messages.push({
          role: "user",
          id: nextId("u"),
          text: userPrompt(text, send.intent, send.focus),
          at: deps.clock.now(),
        });
        conv.updated = deps.clock.iso();
        await deps.store.save(conv);
        const controller = new AbortController();
        state.controller = controller;
        setBusy(state, true);
        state.pending = runTurn(state, send, controller.signal);
        return { conversationId: conv.id };
      });
    },

    async stop(target: Target): Promise<void> {
      const state = states.get(keyOf(target));
      state?.controller?.abort();
      await state?.pending;
    },

    async list(target: Target): Promise<ConversationItem[]> {
      return deps.store.list(target);
    },

    async newConversation(target: Target): Promise<ConversationItem> {
      return serial(keyOf(target), async () => {
        const state = await stateFor(target);
        if (state.busy) throw new AppError("gate.denied", "助手正在回复，稍后再开新对话");
        state.conversation = await deps.store.create(target);
        state.task = undefined;
        const conv = state.conversation;
        return {
          id: conv.id,
          title: conv.title,
          updated: conv.updated,
          messages: 0,
          current: true,
        };
      });
    },

    async usage(target: Target): Promise<ContextUsageView> {
      const state = await stateFor(target);
      const binding = deps.binding();
      const tokens = contextTokens(await buildSystem(state), state.conversation.messages);
      return {
        tokens,
        window: binding.contextWindow,
        percent: Math.min(100, Math.round((tokens / binding.contextWindow) * 100)),
        messages: state.conversation.messages.length,
        compactAt: compactThreshold(binding.contextWindow),
      };
    },

    async compact(target: Target, instructions?: string): Promise<CompactResult> {
      return serial(keyOf(target), async () => {
        const state = await stateFor(target);
        if (state.busy) throw new AppError("gate.denied", "助手正在回复，稍后再压缩");
        return runCompact(state, await buildSystem(state), instructions);
      });
    },

    running(): RunningRow[] {
      return [...states.values()]
        .filter((s) => s.busy)
        .map((s) => ({ target: s.target, source: "assistant" as const, since: s.since }));
    },

    async injectDebrief(target: Target, text: string): Promise<void> {
      const body = text.trim();
      if (!body) return;
      return serial(keyOf(target), async () => {
        const state = await stateFor(target);
        const msg = {
          role: "summary" as const,
          id: nextId("d"),
          text: body,
          at: deps.clock.now(),
          replaced: 0,
        };
        state.conversation.messages.push(msg);
        state.conversation.updated = deps.clock.iso();
        await deps.store.save(state.conversation);
        emit(state, {
          type: "message_end",
          message: { id: msg.id, role: "system", text: msg.text, at: msg.at },
        });
      });
    },

    async idle(target: Target): Promise<void> {
      await states.get(keyOf(target))?.pending;
    },

    async dispose(): Promise<void> {
      for (const state of states.values()) state.controller?.abort();
      await Promise.all([...states.values()].map((s) => s.pending));
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
