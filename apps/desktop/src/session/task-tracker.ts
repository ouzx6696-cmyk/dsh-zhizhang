import { randomUUID } from "node:crypto";
import type { DesktopEvent, TaskEndReason } from "../renderer-contracts";
import { promptContext, toolLabel, toolStep } from "../context";
import { explainError } from "../diagnostics";
import type { Sessions } from "./manager";
import type { SessionEntry, Task } from "./types";

export function createTask(): Task {
  return {
    id: randomUUID(),
    name: "",
    completed: [],
    current: "准备",
    waiting: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    tokens: 0,
    cost: 0,
    startedAt: 0,
  };
}

export function settleTask(
  host: Sessions,
  entry: Pick<SessionEntry, "target" | "focus" | "task" | "phase">,
  outcome: {
    reason: TaskEndReason;
    error?: string;
    role: "writer" | "editor" | "planner";
    conversationId?: string;
  },
) {
  if (entry.task.endedAt !== undefined) return;
  const { reason, role } = outcome;
  const primary = role === "writer";
  const error = outcome.error ? explainError(outcome.error) : undefined;
  entry.task.endedAt = Date.now();
  entry.task.waiting =
    reason === "failed"
      ? error || "任务失败，请核对错误后重试"
      : reason === "cancelled"
        ? "任务已停止，核对已保存结果"
        : "查看稿件与回报，决定是否采纳或定稿";
  entry.phase = "";
  host.emit({
    target: entry.target,
    focus: entry.focus,
    task: entry.task,
    phase: "",
    editor: !primary,
    conversationId: outcome.conversationId,
    event: {
      type: "agent_settled",
      reason,
      error,
      taskId: entry.task.id,
      aborted: reason === "cancelled",
    },
  });
  if (error && primary) host.emit({ target: entry.target, error });
  queueMicrotask(() => host.emit({ running: host.running() }));
  host.emit({ target: entry.target, refresh: true });
}

export function trackSession(options: {
  host: Sessions;
  entry: SessionEntry;
  role: "writer" | "editor" | "planner";
  onUserMessage?: () => void;
}) {
  const { host, entry, role } = options;
  const { session, target } = entry;
  const manager = session.sessionManager;
  const primary = role === "writer",
    editor = role === "editor";
  const task = entry.task;
  let requestId = "",
    startedAt = 0;
  let firstEventMs: number | undefined, firstTextMs: number | undefined;
  session.subscribe((event) => {
    if (event.type === "turn_start") {
      requestId = randomUUID();
      startedAt = Date.now();
      firstEventMs = undefined;
      firstTextMs = undefined;
    }
    if (event.type === "message_update") {
      if (firstEventMs === undefined && startedAt) firstEventMs = Date.now() - startedAt;
      if (
        event.assistantMessageEvent.type === "text_delta" &&
        firstTextMs === undefined &&
        startedAt
      )
        firstTextMs = Date.now() - startedAt;
    }
    if (event.type === "message_end" && event.message.role === "user") {
      const content = event.message.content;
      const text =
        typeof content === "string"
          ? content
          : content
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join("\n");
      const parsed = promptContext(text);
      entry.focus = parsed.context?.focus || {};
      if (entry.profile !== parsed.context?.profile?.id) entry.methods.clear();
      entry.profile = parsed.context?.profile?.id;
      task.id = randomUUID();
      task.name = parsed.text.slice(0, 100);
      task.startedAt = Date.now();
      task.endedAt = undefined;
      task.completed = [];
      task.current = "读材料";
      task.waiting = "";
      task.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      task.tokens = 0;
      task.cost = 0;
      options.onUserMessage?.();
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      task.tokens += event.message.usage.totalTokens || 0;
      task.cost += event.message.usage.cost.total || 0;
      const usage = event.message.usage;
      task.usage.input += usage.input;
      task.usage.output += usage.output;
      task.usage.cacheRead += usage.cacheRead;
      task.usage.cacheWrite += usage.cacheWrite;
      host.extras.log?.("model_usage", {
        role,
        requestId,
        startedAt,
        firstEventMs,
        firstTextMs,
        durationMs: startedAt ? Date.now() - startedAt : undefined,
        stopReason: event.message.stopReason,
        taskId: task.id,
        conversationId: manager.getSessionId(),
        model: event.message.model,
        provider: event.message.provider,
        input: usage.input,
        output: usage.output,
        cacheRead: usage.cacheRead,
        cacheWrite: usage.cacheWrite,
        totalTokens: usage.totalTokens,
        cost: usage.cost.total,
      });
    }
    if (event.type === "compaction_end") {
      if (event.result) entry.methods.clear();
      host.extras.log?.("context_compacted", {
        conversationId: manager.getSessionId(),
        taskId: task.id,
        reason: event.reason,
        aborted: event.aborted,
        success: !!event.result,
        tokensBefore: event.result?.tokensBefore,
        input: event.result?.usage?.input,
        output: event.result?.usage?.output,
        cacheRead: event.result?.usage?.cacheRead,
        cost: event.result?.usage?.cost.total,
        error: event.errorMessage,
      });
    }
    if (event.type === "tool_execution_end" && !event.isError) {
      const step = toolStep(event.toolName, target.mode);
      if (!task.completed.includes(step)) task.completed.push(step);
    }
    if (event.type === "tool_execution_start") task.current = toolStep(event.toolName, target.mode);
    if (event.type === "agent_settled") {
      const last = session.messages.findLast((message) => message.role === "assistant");
      const cancelled =
        event.aborted || (last?.role === "assistant" && last.stopReason === "aborted");
      const failure =
        !cancelled &&
        last?.role === "assistant" &&
        (last.stopReason === "error" || last.stopReason === "length")
          ? last.stopReason === "length"
            ? "输出达到模型上限，任务未确认完成；请核对已保存内容后继续或调整输出预算"
            : last.errorMessage || "模型请求失败，请检查连接后重试"
          : undefined;
      settleTask(host, entry, {
        reason: cancelled ? "cancelled" : failure ? "failed" : "done",
        error: failure,
        role,
        conversationId: manager.getSessionId(),
      });
      return;
    }
    if (event.type === "agent_start") entry.phase = editor ? "编辑审读中…" : "正在创作…";
    if (event.type === "tool_execution_start") entry.phase = toolLabel(event.toolName) + "…";
    if (event.type === "compaction_start") entry.phase = "正在整理对话上下文…";
    if (event.type === "auto_retry_start") entry.phase = "模型连接重试中…";
    const forward = () => {
      let forwarded: DesktopEvent["event"] = event;
      if (event.type === "message_end") {
        let leaf = manager.getLeafEntry();
        while (leaf) {
          if (
            (leaf.type === "message" && leaf.message === event.message) ||
            (leaf.type === "custom_message" &&
              event.message.role === "custom" &&
              leaf.content === event.message.content)
          ) {
            forwarded = {
              ...event,
              message: { ...event.message, writerMessageId: leaf.id },
            };
            break;
          }
          leaf = leaf.parentId ? manager.getEntry(leaf.parentId) : undefined;
        }
      }
      host.emit({
        conversationId: manager.getSessionId(),
        target,
        editor: !primary,
        event: forwarded,
        phase: entry.phase,
        focus: entry.focus,
        task,
      });
    };
    if (event.type === "message_end") queueMicrotask(forward);
    else forward();
    if (
      [
        "agent_start",
        "tool_execution_start",
        "compaction_start",
        "compaction_end",
        "auto_retry_start",
      ].includes(event.type)
    )
      host.emit({ running: host.running() });
  });
}
