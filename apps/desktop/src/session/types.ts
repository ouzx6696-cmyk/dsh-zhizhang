/**
 * 会话层自己的类型：助手对话的持久化格式与“可调用工具的模型端口”。
 * PI SDK 的类型不出 pi-adapter.ts；这里的接口由 pi-adapter 实现，测试用假端口实现。
 */
import type { ModelAnswer } from "@zhizhang/core/model";
import type { FormatVersion } from "@zhizhang/core/paths";

export type JsonArgs = Record<string, unknown>;

export interface AgentToolCall {
  id: string;
  name: string;
  args: JsonArgs;
}

export type AgentMessage =
  | { role: "user"; id: string; text: string; at: number }
  | {
      role: "assistant";
      id: string;
      text: string;
      toolCalls: AgentToolCall[];
      at: number;
      /** 生成该回复的连接与模型；同一连接回放时可原样带回思考签名。 */
      origin?: { connection: string; model: string };
      raw?: unknown;
    }
  | {
      role: "tool";
      id: string;
      callId: string;
      name: string;
      text: string;
      isError: boolean;
      at: number;
    }
  | { role: "summary"; id: string; text: string; at: number; replaced: number };

export interface AssistantToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AssistantTurnRequest {
  connection: string;
  model: string;
  system: string;
  messages: AgentMessage[];
  tools: AssistantToolSpec[];
  maxOutput?: number;
}

export type AssistantTurnEvent =
  { type: "text_delta"; delta: string } | { type: "tool_call"; name: string };

export interface AssistantTurnAnswer {
  text: string;
  toolCalls: AgentToolCall[];
  usage: ModelAnswer["usage"];
  cost: number | null;
  raw?: unknown;
}

/** 一轮“可调用工具”的模型请求；由 pi-adapter 用 PI streamSimple 实现。 */
export interface AssistantPort {
  turn(
    request: AssistantTurnRequest,
    signal: AbortSignal,
    on: (event: AssistantTurnEvent) => void,
  ): Promise<AssistantTurnAnswer>;
}

export interface ConversationFile {
  format: FormatVersion;
  id: string;
  target: { mode: "fanqie" | "toutiao"; path: string };
  title: string;
  created: string;
  updated: string;
  messages: AgentMessage[];
}
