import { useEffect, type RefObject } from "react";
import { scopeId, type Focus, type Target } from "../../context";
import { chatStore } from "../state/chatStore";
import { desktopStore, type ChatMessage, type SystemState } from "../state/store";
import { desktop } from "../state/desktop";

const api = desktop;
const set = desktopStore.set;

/** 事件订阅期间需要反向调用的控制器方法；每次事件实时解引用。 */
interface DesktopHandlers {
  syncState: () => Promise<SystemState>;
  selectSnapshot: (
    next: (Target & { focus?: Focus }) | null | undefined,
    persist?: boolean,
    reopen?: boolean,
  ) => Promise<void>;
  loadProjects: () => Promise<void>;
  jump: (target: Target | null, nextFocus?: Focus) => Promise<void>;
  refreshWorkspace: () => void;
  fail: (error: unknown) => void;
}

interface DesktopEventsInput {
  handlers: RefObject<DesktopHandlers>;
  appearance: SystemState["appearance"] | undefined;
  selected: RefObject<Target | null>;
  archived: RefObject<number | undefined>;
  conversationId: RefObject<string | undefined>;
  pendingMessages: RefObject<ChatMessage[] | null>;
  limit: RefObject<number>;
}

export function useDesktopEvents({
  handlers,
  appearance,
  selected,
  archived,
  conversationId,
  pendingMessages,
  limit,
}: DesktopEventsInput) {
  useEffect(() => {
    const { syncState, selectSnapshot, loadProjects, fail } = handlers.current;
    void (async () => {
      const value = await syncState();
      if (value.target) await selectSnapshot(value.target, false);
      set({ running: await api.running() });
      await loadProjects();
    })().catch(fail);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 启动序列只在挂载时执行一次，方法经 handlers.current 实时解引用。
  }, []);

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
    const unsubscribe = api.subscribe((value) => {
      const { jump, selectSnapshot, loadProjects, refreshWorkspace, fail } = handlers.current;
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
        set({ error: value.error });
        return;
      }
      if (value.refresh) {
        refreshWorkspace();
        void loadProjects().catch(fail);
      }
      const event = value.event;
      if (!event || archived.current !== undefined) return;
      if (
        value.conversationId &&
        conversationId.current &&
        value.conversationId !== conversationId.current
      )
        return;
      if (value.conversationId) conversationId.current = value.conversationId;
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
        if (message.errorMessage) set({ error: message.errorMessage });
      }
      if (event.type === "agent_settled") {
        clearStream();
        chatStore.set({
          busy: false,
          stream: "",
          phase:
            event.reason === "failed"
              ? event.error || "任务失败，请查看错误后重试"
              : event.reason === "cancelled"
                ? "已停止，已保存结果保留"
                : "任务结束，等待你查看结果",
        });
      }
    });
    return () => {
      clearStream();
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 订阅只在挂载时建立；ref 与 handlers.current 每次事件实时读取，不参与依赖。
  }, []);
}
