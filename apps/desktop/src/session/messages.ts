import { estimateTokensRaw } from "@zhizhang/core/model";
import type { ChatMessage, ResultCard, ToolCallView } from "../shared/types.js";
import type { AgentMessage } from "./types.js";
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
      if (hit) hit.isError = msg.isError;
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
