import { randomUUID } from "node:crypto";
import type { AgentSession, SessionManager } from "./pi-adapter";
import type { Target } from "../context";
import type { DesktopEvent } from "../renderer-contracts";
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
    tokens: 0,
    cost: 0,
    startedAt: 0,
  };
}

export function trackSession(options: {
  host: Sessions;
  entry: SessionEntry;
  session: AgentSession;
  manager: SessionManager;
  target: Target;
  primary: boolean;
  editor: boolean;
  role: "writer" | "editor" | "planner";
  onUserMessage?: () => void;
}) {
  const { host, entry, session, manager, target, primary, editor, role } = options;
  const task = entry.task;
  session.subscribe((event) => {
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
      entry.profile = parsed.context?.profile?.id;
      task.id = randomUUID();
      task.name = parsed.text.slice(0, 100);
      task.startedAt = Date.now();
      task.endedAt = undefined;
      task.completed = [];
      task.current = "读材料";
      task.waiting = "";
      task.tokens = 0;
      task.cost = 0;
      options.onUserMessage?.();
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      task.tokens += event.message.usage.totalTokens || 0;
      task.cost += event.message.usage.cost.total || 0;
    }
    if (event.type === "tool_execution_end" && !event.isError) {
      const step = toolStep(event.toolName, target.mode);
      if (!task.completed.includes(step)) task.completed.push(step);
    }
    if (event.type === "tool_execution_start") task.current = toolStep(event.toolName, target.mode);
    if (event.type === "agent_settled") {
      task.endedAt = Date.now();
      const last = session.messages.findLast((message) => message.role === "assistant");
      const failure =
        last?.role === "assistant" && last.stopReason === "error"
          ? explainError(last.errorMessage || "模型请求失败，请检查连接后重试")
          : "";
      task.waiting =
        failure ||
        (event.aborted ? "任务已停止，核对已保存结果" : "查看稿件与回报，决定是否采纳或定稿");
      if (primary && failure) {
        host.emit({ target, error: failure });
        host.extras.log?.("model_error", { role });
      }
    }
    if (event.type === "agent_start") entry.phase = editor ? "编辑审读中…" : "正在创作…";
    if (event.type === "tool_execution_start") entry.phase = toolLabel(event.toolName) + "…";
    if (event.type === "compaction_start") entry.phase = "正在整理对话上下文…";
    if (event.type === "auto_retry_start") entry.phase = "模型连接重试中…";
    if (event.type === "agent_settled") entry.phase = "";
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
        key: host.key(target),
        conversationId: manager.getSessionId(),
        target,
        editor: !primary,
        role,
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
        "auto_retry_start",
        "agent_settled",
      ].includes(event.type)
    )
      host.emit({ running: host.running() });
    if (event.type === "agent_settled") host.emit({ target, refresh: true });
  });
}
