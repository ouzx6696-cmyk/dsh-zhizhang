import { createStore } from "./createStore";
import { useSyncExternalStore } from "react";
import type { TaskState } from "../../renderer-contracts";
import type { ChatMessage, ConversationItem } from "./store";

export type ChatState = {
  messages: ChatMessage[];
  stream: string;
  busy: boolean;
  phase: string;
  task: TaskState | null;
  total: number;
  archive: number | undefined;
  archives: ConversationItem[];
};

const initialChat: ChatState = {
  messages: [],
  stream: "",
  busy: false,
  phase: "",
  task: null,
  total: 0,
  archive: undefined,
  archives: [],
};

export const chatStore = createStore<ChatState>(initialChat);

export function useChatSelector<T>(selector: (state: ChatState) => T): T {
  return useSyncExternalStore(
    chatStore.subscribe,
    () => selector(chatStore.get()),
    () => selector(chatStore.get()),
  );
}
