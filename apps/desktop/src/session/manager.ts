import { toChatMessages, messageTokens } from "./messages.js";
/**
 * 助手会话管理：每个目标一个当前对话；一轮回复经 gateway.session("assistant") 占并发位，
 * 工具来自 ModeModule.tools("assistant", target)，对话历史落盘到状态目录 sessions/。
 */
import { randomBytes } from "node:crypto";
import type { Clock } from "@zhizhang/core/clock";
import { AppError, classify } from "@zhizhang/core/errors";
import { estimateTokensRaw, type ModelGateway } from "@zhizhang/core/model";
import type { ToolCtx, ToolDefinition } from "@zhizhang/core/tool";
import type { DesktopEvent, SessionEvent } from "../shared/events.js";
import type { ContextSettings } from "../shared/settings.js";
import type { ChatMessage, TaskState } from "../shared/types.js";
import type {
  CompactResult,
  ContextUsageView,
  ConversationItem,
  RunningRow,
  SessionSend,
  SessionView,
  Target,
} from "../shared/views.js";
import type { ConversationStore } from "./history.js";
import { COMPACT_SYSTEM, systemPrompt, userPrompt } from "./prompt.js";
import { runTool, toolSpecs } from "./tools.js";
import type { AgentMessage, AssistantPort, ConversationFile } from "./types.js";

const MAX_TOOL_ROUNDS = 12;
const DEFAULT_VIEW_LIMIT = 80;

export interface AssistantBinding {
  connection: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
}

export interface SessionDeps {
  clock: Clock;
  store: ConversationStore;
  gateway(): ModelGateway;
  port(): AssistantPort;
  /** 助手角色的连接绑定；未配置时抛 model.auth。 */
  binding(): AssistantBinding;
  tools(target: Target): ToolDefinition[];
  toolCtx(target: Target): ToolCtx;
  context(): ContextSettings;
  preferences(): string;
  readonly(): boolean;
  title(target: Target): Promise<string | undefined>;
  emit(event: DesktopEvent): void;
  /** 助手忙碌状态变化（用于合并“运行中”列表）。 */
  onBusyChange?(): void;
}

interface TargetState {
  target: Target;
  conversation: ConversationFile;
  busy: boolean;
  stream: string;
  since: string;
  task?: TaskState;
  controller?: AbortController;
  pending?: Promise<void>;
}

const keyOf = (target: Target) => `${target.mode}:${target.path}`;

export { toChatMessages } from "./messages.js";

export function createSessionManager(deps: SessionDeps) {
  const states = new Map<string, TargetState>();
  const sendControllers = new Map<string, AbortController>();
  let idCounter = 0;
  const nextId = (prefix: string) => {
    idCounter += 1;
    return `${prefix}${deps.clock.now().toString(36)}${idCounter.toString(36)}${randomBytes(2).toString("hex")}`;
  };

  async function stateFor(target: Target): Promise<TargetState> {
    const key = keyOf(target);
    const hit = states.get(key);
    if (hit) return hit;
    const conversation = await deps.store.current(target);
    const state: TargetState = {
      target,
      conversation,
      busy: false,
      stream: "",
      since: deps.clock.iso(),
    };
    states.set(key, state);
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

  function contextTokens(system: string, messages: AgentMessage[]): number {
    return messages.reduce((sum, msg) => sum + messageTokens(msg), estimateTokensRaw(system));
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

  async function compactConversation(
    state: TargetState,
    instructions?: string,
  ): Promise<CompactResult> {
    const binding = deps.binding();
    const system = await buildSystem(state);
    const messages = state.conversation.messages;
    const tokensBefore = contextTokens(system, messages);
    const keepBudget = deps.context().keepRecentTokens;
    let keepFrom = messages.length;
    let kept = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
      kept += messageTokens(messages[i]);
      if (kept > keepBudget) break;
      if (messages[i].role === "user") keepFrom = i;
    }
    const older = messages.slice(0, keepFrom);
    if (older.length === 0) {
      return { tokensBefore, tokensAfter: tokensBefore, summary: "" };
    }
    const transcript = older
      .map((msg) => {
        if (msg.role === "user") return `作者：${msg.text}`;
        if (msg.role === "assistant") return `助手：${msg.text}`;
        if (msg.role === "summary") return `此前摘要：${msg.text}`;
        return `工具 ${msg.name}：${msg.text.slice(0, 400)}`;
      })
      .join("\n");
    const controller = new AbortController();
    const answer = await deps.gateway().session(
      "assistant",
      () =>
        deps.port().turn(
          {
            connection: binding.connection,
            model: binding.model,
            system: COMPACT_SYSTEM,
            messages: [
              {
                role: "user",
                id: nextId("u"),
                at: deps.clock.now(),
                text: [instructions?.trim() ? `压缩要求：${instructions.trim()}` : "", transcript]
                  .filter(Boolean)
                  .join("\n\n"),
              },
            ],
            tools: [],
            maxOutput: Math.min(2048, binding.maxTokens),
          },
          controller.signal,
          () => undefined,
        ),
      { scope: keyOf(state.target) },
    );
    const summary = answer.text.trim();
    const replaced = older.length;
    state.conversation.messages = [
      { role: "summary", id: nextId("s"), text: summary, at: deps.clock.now(), replaced },
      ...messages.slice(keepFrom),
    ];
    state.conversation.updated = deps.clock.iso();
    await deps.store.save(state.conversation);
    const tokensAfter = contextTokens(system, state.conversation.messages);
    emit(state, { type: "compacted", tokensBefore, tokensAfter });
    return { tokensBefore, tokensAfter, summary };
  }

  async function runTurn(
    state: TargetState,
    send: SessionSend,
    signal: AbortSignal,
  ): Promise<void> {
    const conv = state.conversation;
    const tools = deps.tools(state.target);
    const specs = toolSpecs(tools);
    const ctx = { ...deps.toolCtx(state.target), signal };
    const task: TaskState = {
      id: nextId("t"),
      name: send.intent ?? "chat",
      completed: [],
      current: "",
      waiting: "",
      tokens: 0,
      cost: 0,
      startedAt: deps.clock.now(),
    };
    state.task = task;
    try {
      const binding = deps.binding();
      const system = await buildSystem(state);
      if (
        deps.context().enabled &&
        contextTokens(system, conv.messages) > compactThreshold(binding.contextWindow)
      ) {
        await compactConversation(state);
      }
      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        state.stream = "";
        const answer = await deps.gateway().session(
          "assistant",
          () =>
            deps.port().turn(
              {
                connection: binding.connection,
                model: binding.model,
                system,
                messages: conv.messages,
                tools: specs,
                maxOutput: binding.maxTokens,
              },
              signal,
              (event) => {
                if (event.type === "text_delta") {
                  state.stream += event.delta;
                  emit(state, { type: "text_delta", delta: event.delta });
                }
              },
            ),
          { scope: keyOf(state.target) },
        );
        task.tokens += answer.usage.input + answer.usage.output;
        task.cost = task.cost === null || answer.cost === null ? null : task.cost + answer.cost;
        conv.messages.push({
          role: "assistant",
          id: nextId("a"),
          text: answer.text,
          toolCalls: answer.toolCalls,
          at: deps.clock.now(),
          origin: { connection: binding.connection, model: binding.model },
          ...(answer.raw !== undefined ? { raw: answer.raw } : {}),
        });
        state.stream = "";
        if (answer.toolCalls.length === 0) break;
        for (const call of answer.toolCalls) {
          task.current = call.name;
          emit(state, { type: "task", task: { ...task } });
          emit(state, { type: "tool", name: call.name, phase: "start" });
          const outcome = await runTool(tools, call, ctx);
          conv.messages.push({
            role: "tool",
            id: nextId("r"),
            callId: call.id,
            name: call.name,
            text: outcome.text,
            isError: outcome.isError,
            at: deps.clock.now(),
          });
          if (!outcome.isError) task.completed.push(call.name);
          emit(state, { type: "tool", name: call.name, phase: "end", isError: outcome.isError });
        }
        task.current = "";
        conv.updated = deps.clock.iso();
        await deps.store.save(conv);
        signal.throwIfAborted();
      }
      task.endedAt = deps.clock.now();
      conv.updated = deps.clock.iso();
      await deps.store.save(conv);
      const view = toChatMessages(conv.messages);
      const last = view[view.length - 1];
      if (last && last.role === "assistant")
        emit(state, { type: "message_end", message: decorate(state, last) });
      emit(state, { type: "task", task: { ...task } });
      emit(state, { type: "end", reason: "done" });
    } catch (err) {
      task.endedAt = deps.clock.now();
      conv.updated = deps.clock.iso();
      await deps.store.save(conv);
      const appErr = classify(err);
      if (signal.aborted || appErr.code === "run.stopped") {
        emit(state, { type: "end", reason: "cancelled" });
      } else {
        emit(state, {
          type: "end",
          reason: "failed",
          error: { code: appErr.code, message: appErr.message },
        });
      }
    } finally {
      state.stream = "";
      state.controller = undefined;
      setBusy(state, false);
    }
  }

  /** 结果卡带上真实目标（落盘消息里只存 runId）。 */
  function decorate(state: TargetState, message: ChatMessage): ChatMessage {
    return message.result
      ? { ...message, result: { ...message.result, target: state.target } }
      : message;
  }

  return {
    async view(
      target: Target,
      options: { conversationId?: string; limit?: number } = {},
    ): Promise<SessionView> {
      const state = await stateFor(target);
      if (options.conversationId && options.conversationId !== state.conversation.id) {
        if (state.busy) throw new AppError("gate.denied", "助手正在回复，稍后再切换对话");
        state.conversation = await deps.store.select(target, options.conversationId);
      }
      const all = toChatMessages(state.conversation.messages).map((m) => decorate(state, m));
      const limit = options.limit ?? DEFAULT_VIEW_LIMIT;
      return {
        conversationId: state.conversation.id,
        messages: all.slice(-limit),
        total: all.length,
        busy: state.busy,
        stream: state.stream,
        ...(state.task ? { task: { ...state.task } } : {}),
      };
    },

    async send(target: Target, send: SessionSend): Promise<{ conversationId: string }> {
      const text = send.text.trim();
      if (!text) throw new AppError("input.invalid", "消息不能为空", { field: "text" });
      const key = keyOf(target);
      if (sendControllers.has(key))
        throw new AppError("gate.denied", "助手正在回复，请稍候或先停止", { busy: true });
      const controller = new AbortController();
      sendControllers.set(key, controller);
      let state: TargetState | undefined;
      try {
        state = await stateFor(target);
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
        state.controller = controller;
        setBusy(state, true);
        await deps.store.save(conv);
        if (controller.signal.aborted) {
          state.controller = undefined;
          setBusy(state, false);
          sendControllers.delete(key);
          return { conversationId: conv.id };
        }
        state.pending = runTurn(state, send, controller.signal).finally(() => {
          if (sendControllers.get(key) === controller) sendControllers.delete(key);
        });
        return { conversationId: conv.id };
      } catch (error) {
        if (sendControllers.get(key) === controller) sendControllers.delete(key);
        if (state?.controller === controller) {
          state.controller = undefined;
          setBusy(state, false);
        }
        throw error;
      }
    },

    async stop(target: Target): Promise<void> {
      sendControllers.get(keyOf(target))?.abort();
      const state = states.get(keyOf(target));
      state?.controller?.abort();
      await state?.pending;
    },

    async list(target: Target): Promise<ConversationItem[]> {
      return deps.store.list(target);
    },

    async newConversation(target: Target): Promise<ConversationItem> {
      const state = await stateFor(target);
      if (state.busy) throw new AppError("gate.denied", "助手正在回复，稍后再开新对话");
      state.conversation = await deps.store.create(target);
      state.task = undefined;
      const conv = state.conversation;
      return { id: conv.id, title: conv.title, updated: conv.updated, messages: 0, current: true };
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
      const state = await stateFor(target);
      if (state.busy) throw new AppError("gate.denied", "助手正在回复，稍后再压缩");
      return compactConversation(state, instructions);
    },

    running(): RunningRow[] {
      return [...states.values()]
        .filter((s) => s.busy)
        .map((s) => ({ target: s.target, source: "assistant" as const, since: s.since }));
    },

    /** 等待某个目标的当前回复结束（关闭与测试用）。 */
    async idle(target: Target): Promise<void> {
      await states.get(keyOf(target))?.pending;
    },

    async dispose(): Promise<void> {
      for (const controller of sendControllers.values()) controller.abort();
      for (const state of states.values()) state.controller?.abort();
      await Promise.all([...states.values()].map((s) => s.pending));
    },
  };
}

export type SessionManager = ReturnType<typeof createSessionManager>;
