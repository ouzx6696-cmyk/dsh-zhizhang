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
  let pendingText = "";
  let pendingThinking = "";
  let scope = "";
  const schedule = (nextScope: string) => {
    if (nextScope !== scope) {
      pendingText = "";
      pendingThinking = "";
      scope = nextScope;
    }
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const text = pendingText;
      const thinking = pendingThinking;
      pendingText = "";
      pendingThinking = "";
      if (chatStore.get().scope === scope) {
        chatStore.set((chat) => ({
          ...(text ? { stream: chat.stream + text } : {}),
          ...(thinking ? { thinkingStream: chat.thinkingStream + thinking } : {}),
        }));
      }
    });
  };
  return {
    pushText(nextScope: string, delta: string) {
      schedule(nextScope);
      pendingText += delta;
    },
    pushThinking(nextScope: string, delta: string) {
      schedule(nextScope);
      pendingThinking += delta;
    },
    clear() {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      pendingText = "";
      pendingThinking = "";
    },
  };
}

function handleSession(
  event: SessionEvent,
  conversationId: string,
  scope: string,
  stream: ReturnType<typeof createStreamBuffer>,
) {
  const chat = chatStore.get();
  if (chat.conversationId && chat.conversationId !== conversationId) return;
  switch (event.type) {
    case "busy":
      chatStore.set({ busy: event.busy, ...(event.busy ? { ended: null } : {}) });
      return;
    case "text_delta":
      stream.pushText(scope, event.delta);
      return;
    case "thinking_delta":
      stream.pushThinking(scope, event.delta);
      return;
    case "message_end":
      stream.clear();
      chatStore.set((current) => {
        const exists = current.messages.some((m) => m.id === event.message.id);
        return {
          messages: [...current.messages.filter((m) => m.id !== event.message.id), event.message],
          total: exists ? current.total : current.total + 1,
          stream: "",
          thinkingStream: "",
        };
      });
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
        thinkingStream: "",
        tool: "",
        ended: {
          reason: event.reason,
          ...(event.error ? { message: ERROR_COPY[event.error.code] } : {}),
        },
      });
      if (event.error)
        notify({ tone: "danger", text: ERROR_COPY[event.error.code], detail: event.error.message });
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
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleRefreshTargets = () => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      refreshTargets().catch(notifyError);
    }, 150);
  };
  const unsubscribe = desktop.subscribe((event: DesktopEvent) => {
    const selected = desktopStore.get().selected?.target ?? null;
    switch (event.kind) {
      case "run": {
        const open = ["running", "paused", "failed", "awaiting-author"].includes(event.run.state);
        set((state) => {
          const rest = state.runs.filter((r) => r.id !== event.run.id);
          const stale = state.runs.find((r) => r.id === event.run.id);
          if (stale && stale.updated > event.run.updated) return {};
          const closeCompare = !open && state.compare?.runId === event.run.id;
          return {
            runs: open ? [event.run, ...rest] : rest,
            ...(closeCompare ? { compare: null } : {}),
          };
        });
        return;
      }
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
          event.scope === "library" ||
          (selected !== null &&
            (scopeKey(selected) === scopeKey(event.target) ||
              (sameMode && event.target.mode === "toutiao")));
        const now = new Date().toLocaleTimeString("zh-CN", {
          hour12: false,
          hour: "2-digit",
          minute: "2-digit",
        });
        if (relevant)
          set((state) => ({
            lastSavedAt: now,
            revisions: { ...state.revisions, [event.scope]: state.revisions[event.scope] + 1 },
          }));
        else set({ lastSavedAt: now });
        if (event.scope === "rows" || event.scope === "article") scheduleRefreshTargets();
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
        notify({
          tone: event.code === "backup.done" ? "success" : "info",
          text: noticeText(event.code),
          detail: event.message,
        });
        return;
      default: {
        const never: never = event;
        return never;
      }
    }
  });
  return () => {
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    stream.clear();
    unsubscribe();
  };
}
