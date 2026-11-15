/** 主进程推送分派：按 kind 穷尽处理，流式增量按帧合并后再写入 chat store。 */
import { DESKTOP_COPY as C, ERROR_COPY } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import type { DesktopEvent, NoticeCode, SessionEvent } from "../../shared/events";
import { chatStore } from "./chatStore";
import { refreshTargets, select } from "./controller";
import { desktop } from "./desktop";
import { desktopStore, scopeKey } from "./store";
import { notifyError } from "../format";

const set = desktopStore.set;

function noticeText(code: NoticeCode): string {
  switch (code) {
    case "settings.reset":
      return C.notice.settingsReset;
    case "workspace.taken_over":
      return C.notice.takenOver;
    case "backup.done":
      return C.notice.backupDone;
    default:
      return ERROR_COPY[code];
  }
}

function createStreamBuffer() {
  let frame = 0;
  let pending = "";
  let scope = "";
  return {
    push(nextScope: string, delta: string) {
      if (nextScope !== scope) {
        pending = "";
        scope = nextScope;
      }
      pending += delta;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const text = pending;
        pending = "";
        if (chatStore.get().scope === scope) chatStore.set((chat) => ({ stream: chat.stream + text }));
      });
    },
    clear() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pending = "";
    },
  };
}

function handleSession(event: SessionEvent, conversationId: string, scope: string, stream: ReturnType<typeof createStreamBuffer>) {
  const chat = chatStore.get();
  if (chat.conversationId && chat.conversationId !== conversationId) return;
  switch (event.type) {
    case "busy":
      chatStore.set({ busy: event.busy, ...(event.busy ? { ended: null } : {}) });
      return;
    case "text_delta":
      stream.push(scope, event.delta);
      return;
    case "message_end":
      stream.clear();
      chatStore.set((current) => ({
        messages: [...current.messages.filter((m) => m.id !== event.message.id), event.message],
        total: current.total + 1,
        stream: "",
      }));
      return;
    case "tool":
      chatStore.set({ tool: event.phase === "start" ? event.name : "" });
      return;
    case "task":
      chatStore.set({ task: event.task });
      return;
    case "compacted":
      notify({ tone: "info", text: C.agent.compacted(event.tokensBefore, event.tokensAfter) });
      return;
    case "end":
      stream.clear();
      chatStore.set({
        busy: false,
        stream: "",
        tool: "",
        ended: { reason: event.reason, ...(event.error ? { message: ERROR_COPY[event.error.code] } : {}) },
      });
      if (event.error) notify({ tone: "danger", text: ERROR_COPY[event.error.code], detail: event.error.message });
      return;
    default: {
      const never: never = event;
      return never;
    }
  }
}

/** 订阅主进程事件；返回取消函数。 */
export function subscribeDesktopEvents(): () => void {
  const stream = createStreamBuffer();
  const unsubscribe = desktop.subscribe((event: DesktopEvent) => {
    const selected = desktopStore.get().selected?.target ?? null;
    switch (event.kind) {
      case "run":
        return;
      case "running": {
        set({ running: event.rows });
        return;
      }
      case "session": {
        const scope = scopeKey(event.target);
        if (scope !== chatStore.get().scope) return;
        handleSession(event.event, event.conversationId, scope, stream);
        return;
      }
      case "workspace.changed": {
        const sameMode = selected?.mode === event.target.mode;
        const relevant =
          selected !== null &&
          (scopeKey(selected) === scopeKey(event.target) || (sameMode && event.target.mode === "toutiao"));
        if (relevant)
          set((state) => ({ revisions: { ...state.revisions, [event.scope]: state.revisions[event.scope] + 1 } }));
        if (event.scope === "rows" || event.scope === "article") refreshTargets().catch(notifyError);
        return;
      }
      case "workspace.status":
        set({ workspace: event.status });
        return;
      case "navigate":
        select(event.target, event.focus ?? {})
          .then(() => {
            if (event.focus?.candidate) set({ dockTab: "pipeline", dockOpen: true });
          })
          .catch(notifyError);
        return;
      case "updates":
        set((state) => ({ app: state.app ? { ...state.app, updates: event.status } : null }));
        return;
      case "notice":
        notify({ tone: event.code === "backup.done" ? "success" : "info", text: noticeText(event.code), detail: event.message });
        return;
      default: {
        const never: never = event;
        return never;
      }
    }
  });
  return () => {
    stream.clear();
    unsubscribe();
  };
}
