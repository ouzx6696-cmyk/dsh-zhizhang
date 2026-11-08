import { randomUUID } from "node:crypto";
import type { DesktopEvent, TaskEndReason } from "../renderer-contracts";
import { promptContext, toolLabel, toolStep, type Target } from "../context";
import { explainError } from "../diagnostics";
import { sha256 } from "../../../../packages/core/src/fsx";
import { asRecord } from "../main/ipc/validate";
import type { Sessions } from "./manager";
import type { SessionEntry, Task } from "./types";

/** v2 注入去重的最小读取口：该目标当前会话已注入方法的凭据；会话尚未建立时为 undefined。 */
export function injectedMethods(host: Sessions, target: Target) {
  return host.sessions.get(host.key(target))?.methods;
}

/** PI 事件把工具结果标为 any，这里只在边界取错误文本，其余形状不信任。 */
function toolErrorText(result: unknown) {
  const parts = asRecord(result, "工具执行回执").content;
  if (!Array.isArray(parts)) throw new Error("工具执行回执缺少内容列表");
  for (const part of parts) {
    const block = asRecord(part, "工具内容块");
    if (block.type === "text" && typeof block.text === "string") return block.text;
  }
  return undefined;
}

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
  let lastUserText: string | undefined,
    preCompaction: { tokens: number; contextWindow: number } | undefined;
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
      lastUserText = parsed.text;
      entry.focus = parsed.context?.focus || {};
      if (entry.profile !== parsed.context?.profile?.id) entry.methods.clear();
      entry.profile = parsed.context?.profile?.id;
      // v2 注入以 writer-method 块携带全文：凭据给 id/profile/hash，块哈希锚定实际进入上下文的内容。
      // 带裁剪说明且没有块的方法没进上下文，不记凭据，下个任务重试全文注入。
      const blocks = new Map(parsed.methods.map((block) => [block.id, block]));
      if (Array.isArray(parsed.context?.methods)) {
        const credentials: { id: string; profile: string; hash: string; note?: string }[] = [];
        for (const method of parsed.context.methods) {
          if (
            typeof method.id !== "string" ||
            typeof method.profile !== "string" ||
            typeof method.hash !== "string"
          )
            throw new Error("任务方法凭据无效");
          credentials.push({
            id: method.id,
            profile: method.profile,
            hash: method.hash,
            note: typeof method.note === "string" ? method.note : undefined,
          });
        }
        for (const method of credentials) {
          if (method.note !== undefined) continue;
          const block = blocks.get(method.id);
          entry.methods.set(method.id, {
            id: method.id,
            profile: method.profile,
            hash: block ? sha256(block.text) : method.hash,
          });
        }
        const intent = parsed.context?.intent;
        if (typeof intent === "string")
          entry.handoff = {
            intentSource: parsed.context?.focus?.intent ? "focus" : "state",
            intent,
            methods: credentials.map((method) => {
              const block = blocks.get(method.id);
              return {
                id: method.id,
                bytes: block ? Buffer.byteLength(block.text) : 0,
                injected: block !== undefined,
                trimmed: method.note !== undefined,
              };
            }),
          };
      }
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
    if (event.type === "compaction_start") {
      entry.phase = "正在整理对话上下文…";
      // 压缩后 tokens 归零不可信，触发比例必须在 compaction_start 时读取
      const usage = session.getContextUsage();
      if (usage && usage.tokens !== null)
        preCompaction = { tokens: usage.tokens, contextWindow: usage.contextWindow };
    }
    if (event.type === "compaction_end") {
      if (event.result) entry.methods.clear();
      host.extras.log?.("context_compacted", {
        conversationId: manager.getSessionId(),
        taskId: task.id,
        // PI 只经 Sessions.compact 发 manual；threshold/overflow 都是内部自动触发
        trigger: event.reason === "manual" ? "manual" : "auto",
        thresholdRatio: preCompaction
          ? preCompaction.tokens / preCompaction.contextWindow
          : undefined,
        lastUserPreview: lastUserText?.slice(0, 200),
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
    if (event.type === "tool_execution_end") {
      const text = toolErrorText(event.result);
      const error = event.isError ? text : undefined;
      // 门禁拒绝有两种可见形态：门禁引擎 deny 抛错（【门禁 前缀），引擎工具把
      // WriterError("GATE_DENIED") 以 错误[GATE_DENIED] 文本随成功回执带回
      const denied =
        text !== undefined && (text.startsWith("【门禁") || text.startsWith("错误[GATE_DENIED]"));
      host.extras.log?.("tool_call", {
        role,
        tool: event.toolName,
        error,
        ...(denied ? { denied: true } : {}),
      });
      if (!event.isError) {
        const step = toolStep(event.toolName, target.mode);
        if (!task.completed.includes(step)) task.completed.push(step);
      }
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
    // 渲染层只用主会话的文本增量。PI 的 message 与 assistantMessageEvent.partial 都是累积全文快照，
    // 逐 token 原样转发会让 IPC 复制量随输出长度平方增长；增量也不改 task/phase，不必随附。
    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (primary && update.type === "text_delta")
        host.emit({
          conversationId: manager.getSessionId(),
          target,
          event: {
            type: "message_update",
            assistantMessageEvent: { type: "text_delta", delta: update.delta },
          },
        });
      return;
    }
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
