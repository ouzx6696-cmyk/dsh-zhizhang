import { useEffect } from "react";
import { taskEndCopy } from "../../../../../packages/ui/src/copy";
import { notify } from "../../../../../packages/ui/src/notify";
import { scopeId, type Target } from "../../context";
import { chatStore } from "../state/chatStore";
import { desktopStore, useDesktopSelector, type ChatMessage } from "../state/store";
import { desktop, onDesktopEvent } from "../state/desktop";
import type { DesktopActions } from "./useDesktopController";

const api = desktop;
const set = desktopStore.set;

interface DesktopEventsInput {
  actions: DesktopActions;
  selected: { current: Target | null };
  archived: { current: number | undefined };
  conversationId: { current: string | undefined };
  pendingMessages: { current: ChatMessage[] | null };
  limit: { current: number };
}

export function useDesktopEvents({
  actions,
  selected,
  archived,
  conversationId,
  pendingMessages,
  limit,
}: DesktopEventsInput) {
  const appearance = useDesktopSelector((state) => state.system?.appearance);
  useEffect(() => {
    const { syncState, selectSnapshot, loadProjects, fail } = actions;
    const startup = async () => {
      const value = await syncState();
      if (value.target) await selectSnapshot(value.target, false);
      const [running] = await Promise.all([api.running(), loadProjects()]);
      set({ running });
    };
    startup().catch((error) => fail(error, startup));
  }, [actions]);

  useEffect(() => {
    if (!appearance) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        appearance.theme === "system" ? (media.matches ? "dark" : "light") : appearance.theme;
      document.documentElement.dataset.font = appearance.font;
      document.documentElement.dataset.transparency = appearance.reducedTransparency
        ? "reduced"
        : "normal";
      document.documentElement.style.setProperty("--ui-body-size", appearance.fontSize + "px");
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [appearance]);

  useEffect(() => {
    let frame = 0,
      delta = "",
      streamScope = "";
    const clearStream = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      delta = "";
    };
    const { jump, selectSnapshot, loadProjects, refreshWorkspace, fail } = actions;
    const unsubscribe = onDesktopEvent((value) => {
      if (value.running) {
        set({ running: value.running });
        if (archived.current === undefined)
          chatStore.set({
            busy: value.running.some((row) => scopeId(row.target) === scopeId(selected.current)),
          });
      }
      if (value.updates) {
        const updates = value.updates;
        set((current) => ({
          system: current.system ? { ...current.system, updates } : null,
        }));
      }
      if (value.navigate) {
        void jump(value.navigate, value.focus).catch(fail);
        return;
      }
      if (value.selection) {
        void selectSnapshot(value.selection, false).catch(fail);
        return;
      }
      if (value.target && scopeId(value.target) !== scopeId(selected.current)) return;
      if (value.error) {
        notify({ tone: "danger", text: value.error });
        return;
      }
      if (value.refresh) {
        refreshWorkspace();
        void loadProjects().catch(fail);
      }
      if (value.conversationId && !value.event) {
        // 只携带 conversationId 的事件是主进程对新会话的显式告知；先接受它，后续事件才不会被旧 id 挡住。
        if (archived.current === undefined) conversationId.current = value.conversationId;
        return;
      }
      const event = value.event;
      if (!event || archived.current !== undefined) return;
      if (value.conversationId) {
        if (conversationId.current && value.conversationId !== conversationId.current) return;
        conversationId.current = value.conversationId;
      }
      if (value.phase) chatStore.set({ phase: value.phase });
      if (value.task && !value.editor) chatStore.set({ task: { ...value.task } });
      if (value.editor) return;
      if (event.type === "task_preparing") chatStore.set({ busy: true });
      if (event.type === "agent_start") chatStore.set({ busy: true, stream: "" });
      if (event.type === "compaction_start" || event.type === "auto_retry_start")
        chatStore.set({ busy: true });
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        const nextScope = scopeId(value.target) + value.conversationId;
        if (nextScope !== streamScope) {
          clearStream();
          streamScope = nextScope;
        }
        delta += event.assistantMessageEvent.delta;
        if (!frame) {
          const key = scopeId(value.target),
            id = value.conversationId;
          frame = requestAnimationFrame(() => {
            if (
              key === scopeId(selected.current) &&
              id === conversationId.current &&
              archived.current === undefined
            )
              chatStore.set((current) => ({ stream: current.stream + delta }));
            frame = 0;
            delta = "";
          });
        }
      }
      if (event.type === "message_end") {
        const message = event.message as ChatMessage | undefined;
        if (!message) return;
        if (pendingMessages.current) pendingMessages.current.push(message);
        else
          chatStore.set((current) => ({
            messages: [...current.messages, message].slice(-limit.current),
            total: current.total + 1,
          }));
        if (message.role === "assistant") {
          clearStream();
          chatStore.set({ stream: "" });
        }
        if (message.errorMessage) notify({ tone: "danger", text: message.errorMessage });
      }
      if (event.type === "agent_settled") {
        clearStream();
        chatStore.set({
          busy: false,
          stream: "",
          phase: taskEndCopy(event.reason, event.error),
        });
      }
    });
    return () => {
      clearStream();
      unsubscribe();
    };
    // 控制器与这些 ref 都只建一次，订阅随之只建立一次；ref 的内容每次事件实时读取。
  }, [actions, selected, archived, conversationId, pendingMessages, limit]);
}
