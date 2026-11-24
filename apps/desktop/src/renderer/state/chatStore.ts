/** 助手会话状态（高频增量独立成 store，避免带动整个外壳重渲染）。 */
import type { ChatMessage, TaskState } from "../../shared/types";
import type { ContextUsageView, ConversationItem } from "../../shared/views";
import { createStore, useStoreSelector } from "./createStore";

export interface ChatState {
  scope: string;
  conversationId: string;
  messages: ChatMessage[];
  total: number;
  busy: boolean;
  stream: string;
  thinkingStream: string;
  task: TaskState | null;
  /** 正在调用的工具名（界面显示中文标签）。 */
  tool: string;
  conversations: ConversationItem[];
  usage: ContextUsageView | null;
  /** 最近一轮的结束原因；failed 时附错误。 */
  ended: { reason: "done" | "cancelled" | "failed"; message?: string } | null;
}

export const emptyChat: ChatState = {
  scope: "",
  conversationId: "",
  messages: [],
  total: 0,
  busy: false,
  stream: "",
  thinkingStream: "",
  task: null,
  tool: "",
  conversations: [],
  usage: null,
  ended: null,
};

export const chatStore = createStore<ChatState>(emptyChat);

export function useChat<R>(selector: (state: ChatState) => R): R {
  return useStoreSelector(chatStore, selector);
}
