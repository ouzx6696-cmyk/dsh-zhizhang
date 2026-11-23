/**
 * 会话消息投影与 Token 估算：把落盘消息折叠为界面消息并绑定结果卡目标。
 */
import { estimateTokensRaw } from "@zhizhang/core/model";
import type { ChatMessage, ResultCard, ToolCallView } from "../shared/types.js";
import type { Target } from "../shared/views.js";
import type { AgentMessage } from "./types.js";

function summarizeToolOutput(raw: string): string {
  const compact = raw.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  try {
    const parsed: unknown = JSON.parse(compact);
    if (typeof parsed === "object" && parsed !== null) {
      if ("title" in parsed && typeof parsed.title === "string") {
        const words =
          "body" in parsed && typeof parsed.body === "string" ? ` · ${parsed.body.length} 字` : "";
        return `${parsed.title}${words}`;
      }
      if ("chapters" in parsed && Array.isArray(parsed.chapters)) {
        return `共 ${parsed.chapters.length} 章`;
      }
      if ("findings" in parsed && Array.isArray(parsed.findings)) {
        return `巡检命中 ${parsed.findings.length} 条`;
      }
      if ("candidates" in parsed && Array.isArray(parsed.candidates)) {
        return `候选稿 ${parsed.candidates.length} 份`;
      }
      if ("entities" in parsed && Array.isArray(parsed.entities)) {
        return `实体 ${parsed.entities.length} 条`;
      }
      if ("runId" in parsed && typeof parsed.runId === "string") {
        return `runId: ${parsed.runId}`;
      }
    }
  } catch {
    // 非 JSON 文本直接截断展示
  }
  return compact.length > 140 ? `${compact.slice(0, 140)}…` : compact;
}

/** 把落盘消息折叠成界面消息：一轮里的工具调用并入该轮的助手回复。 */
export function toChatMessages(messages: AgentMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  let texts: string[] = [];
  let tools: ToolCallView[] = [];
  let result: ResultCard | undefined;
  let turnId = "";
  let turnAt = 0;
  const flush = () => {
    if (texts.length === 0 && tools.length === 0) return;
    out.push({
      id: turnId,
      role: "assistant",
      text: texts.join("\n\n"),
      at: turnAt,
      ...(tools.length ? { tools } : {}),
      ...(result ? { result } : {}),
    });
    texts = [];
    tools = [];
    result = undefined;
  };
  for (const msg of messages) {
    if (msg.role === "user") {
      flush();
      out.push({ id: msg.id, role: "user", text: msg.text, at: msg.at });
    } else if (msg.role === "summary") {
      flush();
      out.push({ id: msg.id, role: "system", text: msg.text, at: msg.at });
    } else if (msg.role === "assistant") {
      turnId = msg.id;
      turnAt = msg.at;
      if (msg.text.trim()) texts.push(msg.text);
      for (const call of msg.toolCalls) tools.push({ name: call.name, isError: false });
    } else {
      const hit = [...tools].reverse().find((t) => t.name === msg.name);
      if (hit) {
        hit.isError = msg.isError;
        const summary = summarizeToolOutput(msg.text);
        if (summary) hit.summary = summary;
      }
      if (!msg.isError) {
        try {
          const value: unknown = JSON.parse(msg.text);
          if (
            typeof value === "object" &&
            value !== null &&
            "runId" in value &&
            typeof value.runId === "string"
          ) {
            result = {
              kind: "run",
              target: { mode: "fanqie", path: "" },
              runId: value.runId,
              ...("kind" in value && typeof value.kind === "string"
                ? { pipeline: value.kind }
                : {}),
            };
          }
        } catch {
          // 工具输出不是 JSON（自定义 render）时不生成结果卡
        }
      }
    }
  }
  flush();
  return out;
}

export function messageTokens(msg: AgentMessage): number {
  if (msg.role === "assistant") {
    return estimateTokensRaw(msg.text) + estimateTokensRaw(JSON.stringify(msg.toolCalls));
  }
  return estimateTokensRaw(msg.text);
}

export function contextTokens(system: string, messages: AgentMessage[]): number {
  return messages.reduce((sum, msg) => sum + messageTokens(msg), estimateTokensRaw(system));
}

/** 结果卡带上真实目标（落盘消息里只存 runId）。 */
export function decorateMessage(target: Target, message: ChatMessage): ChatMessage {
  return message.result ? { ...message, result: { ...message.result, target } } : message;
}
