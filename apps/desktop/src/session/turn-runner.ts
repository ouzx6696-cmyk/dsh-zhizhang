/**
 * 助手单轮执行器：看门狗、瞬态重试、上下文溢出自动压缩、流式思考/正文推送与工具批处理循环。
 */
import type { Clock } from "@zhizhang/core/clock";
import { AppError, classify, isAppError } from "@zhizhang/core/errors";
import { createWatchdog, withRetry, type ModelGateway } from "@zhizhang/core/model";
import type { ToolCtx, ToolDefinition } from "@zhizhang/core/tool";
import type { DesktopEvent, SessionEvent } from "../shared/events.js";
import type { ContextSettings, ThinkingLevel } from "../shared/settings.js";
import type { TaskState } from "../shared/types.js";
import type { CompactResult, SessionSend, Target } from "../shared/views.js";
import type { ConversationStore } from "./history.js";
import { contextTokens, decorateMessage, toChatMessages } from "./projection.js";
import { executeToolBatch, toolSpecs } from "./tools.js";
import type { AssistantPort, AssistantTurnAnswer, ConversationFile } from "./types.js";

const MAX_TOOL_ROUNDS = 12;

export interface AssistantBinding {
  connection: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
  thinking?: ThinkingLevel;
  temperature?: number;
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

export interface TargetState {
  target: Target;
  conversation: ConversationFile;
  busy: boolean;
  stream: string;
  thinkingStream: string;
  since: string;
  task?: TaskState;
  controller?: AbortController;
  pending?: Promise<void>;
}

export interface TurnRunnerHost {
  deps: SessionDeps;
  keyOf(target: Target): string;
  nextId(prefix: string): string;
  emit(state: TargetState, event: SessionEvent): void;
  setBusy(state: TargetState, busy: boolean): void;
  compactThreshold(window: number): number;
  buildSystem(state: TargetState): Promise<string>;
  runCompact(
    state: TargetState,
    system: string,
    instructions?: string,
    signal?: AbortSignal,
  ): Promise<CompactResult>;
}

async function invokeRound(
  host: TurnRunnerHost,
  state: TargetState,
  binding: AssistantBinding,
  system: string,
  specs: ReturnType<typeof toolSpecs>,
  signal: AbortSignal,
): Promise<AssistantTurnAnswer> {
  const { deps } = host;
  const scope = host.keyOf(state.target);
  const callOnce = () =>
    withRetry(
      async () => {
        state.stream = "";
        state.thinkingStream = "";
        const watchdog = createWatchdog(signal);
        try {
          return await deps.gateway().session(
            "assistant",
            () =>
              deps.port().turn(
                {
                  connection: binding.connection,
                  model: binding.model,
                  system,
                  messages: state.conversation.messages,
                  tools: specs,
                  maxOutput: binding.maxTokens,
                  ...(binding.thinking ? { thinking: binding.thinking } : {}),
                  ...(binding.temperature !== undefined
                    ? { temperature: binding.temperature }
                    : {}),
                  sessionId: state.conversation.id,
                  cacheRetention: "short",
                },
                watchdog.signal,
                (event) => {
                  watchdog.poke();
                  if (event.type === "text_delta") {
                    state.stream += event.delta;
                    host.emit(state, { type: "text_delta", delta: event.delta });
                  } else if (event.type === "thinking_delta") {
                    state.thinkingStream += event.delta;
                    host.emit(state, { type: "thinking_delta", delta: event.delta });
                  }
                },
              ),
            { scope, signal: watchdog.signal },
          );
        } catch (err) {
          if (watchdog.signal.aborted && !signal.aborted) {
            const reason: unknown = watchdog.signal.reason;
            throw reason instanceof AppError
              ? reason
              : new AppError("model.stalled", "模型流式响应超时");
          }
          throw err;
        } finally {
          watchdog.dispose();
        }
      },
      deps.clock,
      signal,
    );

  try {
    return await callOnce();
  } catch (err) {
    if (
      isAppError(err, "model.context_overflow") &&
      deps.context().enabled &&
      state.conversation.messages.length > 2
    ) {
      await host.runCompact(state, system, undefined, signal);
      return await callOnce();
    }
    throw err;
  }
}

export async function runSessionTurn(
  host: TurnRunnerHost,
  state: TargetState,
  send: SessionSend,
  signal: AbortSignal,
): Promise<void> {
  const { deps } = host;
  const conv = state.conversation;
  const tools = deps.tools(state.target);
  const specs = toolSpecs(tools);
  const ctx = { ...deps.toolCtx(state.target), signal };
  const task: TaskState = {
    id: host.nextId("t"),
    name: send.intent ?? "chat",
    completed: [],
    current: "",
    waiting: "",
    tokens: 0,
    cachedTokens: 0,
    cost: 0,
    startedAt: deps.clock.now(),
  };
  state.task = task;
  try {
    const binding = deps.binding();
    const system = await host.buildSystem(state);
    if (
      deps.context().enabled &&
      contextTokens(system, conv.messages) > host.compactThreshold(binding.contextWindow)
    ) {
      await host.runCompact(state, system, undefined, signal);
    }
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const answer = await invokeRound(host, state, binding, system, specs, signal);
      task.tokens += answer.usage.input + answer.usage.output;
      task.cachedTokens = (task.cachedTokens ?? 0) + answer.usage.cachedInput;
      task.cost = task.cost === null || answer.cost === null ? null : task.cost + answer.cost;
      conv.messages.push({
        role: "assistant",
        id: host.nextId("a"),
        text: answer.text,
        ...(answer.thinking ? { thinking: answer.thinking } : {}),
        toolCalls: answer.toolCalls,
        at: deps.clock.now(),
        origin: { connection: binding.connection, model: binding.model },
        ...(answer.raw !== undefined ? { raw: answer.raw } : {}),
      });
      state.stream = "";
      state.thinkingStream = "";
      if (answer.toolCalls.length === 0) break;
      await executeToolBatch(tools, answer.toolCalls, ctx, {
        onBatchStart(names) {
          task.current = names.join(" / ");
          host.emit(state, { type: "task", task: { ...task } });
        },
        onToolStart(call) {
          host.emit(state, { type: "tool", name: call.name, phase: "start" });
        },
        onToolEnd(call, outcome) {
          conv.messages.push({
            role: "tool",
            id: host.nextId("r"),
            callId: call.id,
            name: call.name,
            text: outcome.text,
            isError: outcome.isError,
            at: deps.clock.now(),
          });
          if (!outcome.isError) task.completed.push(call.name);
          host.emit(state, {
            type: "tool",
            name: call.name,
            phase: "end",
            isError: outcome.isError,
          });
        },
      });
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
    if (last && last.role === "assistant") {
      host.emit(state, { type: "message_end", message: decorateMessage(state.target, last) });
    }
    host.emit(state, { type: "task", task: { ...task } });
    host.emit(state, { type: "end", reason: "done" });
  } catch (err) {
    task.endedAt = deps.clock.now();
    conv.updated = deps.clock.iso();
    await deps.store.save(conv);
    const appErr = classify(err);
    if (signal.aborted || appErr.code === "run.stopped") {
      host.emit(state, { type: "end", reason: "cancelled" });
    } else {
      host.emit(state, {
        type: "end",
        reason: "failed",
        error: { code: appErr.code, message: appErr.message },
      });
    }
  } finally {
    state.stream = "";
    state.thinkingStream = "";
    state.controller = undefined;
    host.setBusy(state, false);
  }
}
