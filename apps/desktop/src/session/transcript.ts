/**
 * PI 适配层纯逻辑辅助：供应商别名映射与中断会话孤立工具调用修复。
 * 保持零 PI SDK 依赖，便于单元测试直接校验。
 */
import type { AgentMessage } from "./types.js";

/** 织章连接里的 provider 简称 → PI 1.5 内置目录 providerId 映射。 */
const PROVIDER_ALIASES: Readonly<Record<string, string>> = {
  kimi: "moonshotai-cn",
  moonshot: "moonshotai-cn",
  "moonshot-cn": "moonshotai-cn",
  minimax: "minimax-cn",
  qwen: "qwen-token-plan-cn",
  dashscope: "qwen-token-plan-cn",
  tongyi: "qwen-token-plan-cn",
  glm: "zai-coding-cn",
  zhipu: "zai-coding-cn",
  bigmodel: "zai-coding-cn",
  gemini: "google",
  claude: "anthropic",
  mimo: "xiaomi-token-plan-cn",
  xiaomi: "xiaomi-token-plan-cn",
};

export function resolvePiProviderId(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  return PROVIDER_ALIASES[normalized] ?? normalized;
}

const INTERRUPTED_TOOL_TEXT = JSON.stringify({
  ok: false,
  code: "run.stopped",
  message: "上一次工具调用在完成前被中断，结果不可用。",
});

/**
 * 修复因点击停止或进程异常退出导致的“孤立 toolCall”：
 * 若某条 assistant 消息声明了 toolCalls，而紧随其后的 tool 消息中缺少对应的 callId，
 * 自动在正确位置补齐合成的中断 toolResult，避免上游模型接口因 tool_use/tool_result 不配对报 400。
 */
export function repairOrphanedToolCalls(messages: readonly AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    out.push(msg);
    if (msg.role !== "assistant" || msg.toolCalls.length === 0) {
      i += 1;
      continue;
    }
    const present = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === "tool") {
      const toolMsg = messages[j];
      if (toolMsg.role === "tool") {
        present.add(toolMsg.callId);
        out.push(toolMsg);
      }
      j += 1;
    }
    for (const call of msg.toolCalls) {
      if (!present.has(call.id)) {
        out.push({
          role: "tool",
          id: `repair-${call.id}`,
          callId: call.id,
          name: call.name,
          text: INTERRUPTED_TOOL_TEXT,
          isError: true,
          at: msg.at,
        });
      }
    }
    i = j;
  }
  return out;
}
