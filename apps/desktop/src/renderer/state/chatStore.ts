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

class ChatStore {
  state: ChatState = initialChat;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = () => this.state;
  set = (patch: Partial<ChatState> | ((state: ChatState) => Partial<ChatState>)) => {
    this.state = {
      ...this.state,
      ...(typeof patch === "function" ? patch(this.state) : patch),
    };
    for (const listener of this.listeners) listener();
  };
}

export const chatStore = new ChatStore();

export function useChatSelector<T>(selector: (state: ChatState) => T): T {
  return useSyncExternalStore(
    chatStore.subscribe,
    () => selector(chatStore.get()),
    () => selector(chatStore.get()),
  );
}
