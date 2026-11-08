import { errorText } from "../../../../../packages/core/src/errors.js";
import { DEFAULT_HISTORY_LIMIT } from "../../history-options";
import { useDraftProtection } from "./useDraftProtection";
import { useDesktopEvents } from "./useDesktopEvents";
import { useEffect, useRef } from "react";
import { scopeId, type Focus, type Target } from "../../context";
import type { WorkspaceContext } from "../../renderer-contracts";
import { desktopStore, useDesktop, type ChatMessage } from "../state/store";
import { chatStore } from "../state/chatStore";
import { PREF, readPref } from "../../../../../packages/workbench/src/client/shared/prefs.js";
import { remember } from "../state/prefs";
import { runCommand } from "../../commands";
import { deliverAction, startNewWork } from "../features/agent/taskActions";
import { desktop } from "../state/desktop";
import { useDesktopShortcuts } from "./useDesktopShortcuts";

const api = desktop;
const set = desktopStore.set;

export function useDesktopController() {
  const state = useDesktop();
  const selected = useRef<Target | null>(null);
  const focused = useRef<Focus>({});
  const limit = useRef(DEFAULT_HISTORY_LIMIT);
  const viewRequest = useRef(0);
  const selectionRequest = useRef(0);
  const pendingMessages = useRef<ChatMessage[] | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const archived = useRef<number | undefined>(undefined);
  const { canLeave, canRestart, discardSource, trackMethodEdit, trackSourceEdit } =
    useDraftProtection(focused, (message) => set({ error: message }));
  const contextRef = useRef<WorkspaceContext>(state.context);
  contextRef.current = state.context;

  function fail(error: unknown) {
    set({ error: errorText(error) });
  }

  function refreshWorkspace() {
    void Promise.resolve(contextRef.current.actions?.refresh?.()).catch(fail);
  }

  function setPosition(next: Focus) {
    focused.current = next;
    set({ focus: next });
  }

  async function syncState() {
    const value = await api.state();
    set((current) => ({
      system: value,
      wizardModels: current.wizardModels || value.models,
      onboarding:
        current.onboarding === null
          ? !value.models.writer.configured || !value.workspace
          : current.onboarding,
    }));
    if (value.notice) set({ error: value.notice });
    return value;
  }

  async function loadProjects() {
    set({ projects: await api.projects() });
  }

  async function loadView(target: Target, maximum = DEFAULT_HISTORY_LIMIT, old?: number) {
    const request = ++viewRequest.current,
      buffer: ChatMessage[] = [];
    pendingMessages.current = buffer;
    try {
      const value = await api.view(target, maximum, old);
      if (request !== viewRequest.current || scopeId(target) !== scopeId(selected.current)) return;
      conversationId.current = value.conversationId;
      const known = new Set(value.messages.map((message) => message.writerMessageId)),
        extra = buffer.filter(
          (message) => !message.writerMessageId || !known.has(message.writerMessageId),
        );
      chatStore.set({
        messages: [...value.messages, ...extra].slice(-maximum),
        total: value.total + extra.length,
        busy: value.busy,
        phase: value.phase || "",
        stream: value.stream,
        task: value.task || null,
      });
    } finally {
      if (pendingMessages.current === buffer) pendingMessages.current = null;
    }
  }

  async function selectSnapshot(
    next: (Target & { focus?: Focus }) | null | undefined,
    persist = true,
    reopen = false,
  ) {
    if (!next) return;
    const request = ++selectionRequest.current;
    const { focus: nextFocus = {}, ...target } = next,
      previous = selected.current;
    if (target.mode === "toutiao" && nextFocus.article) target.article = nextFocus.article;
    if (scopeId(previous) === scopeId(target)) {
      if (reopen) {
        await api.select(target);
        if (request !== selectionRequest.current) return;
        await syncState();
      }
      if (next.focus) setPosition(nextFocus);
      return;
    }
    const chosen = persist ? await api.select(target) : target;
    if (request !== selectionRequest.current) return;
    setPosition(nextFocus);
    const preserve =
      !previous &&
      (target.mode === "fanqie"
        ? readPref(PREF.work) === (target.work || "")
        : readPref(PREF.ttRoot) === target.root);
    remember(target, nextFocus, preserve);
    archived.current = undefined;
    limit.current = DEFAULT_HISTORY_LIMIT;
    chatStore.set({
      archive: undefined,
      messages: [],
      stream: "",
      task: null,
      busy: false,
    });
    selected.current = chosen;
    await syncState();
    const [, archives] = await Promise.all([loadView(chosen), api.conversations(chosen)]);
    chatStore.set({ archives });
  }

  // Event subscriptions stay mounted; dereference the current controller on each event.
  const handlers = useRef({
    syncState,
    selectSnapshot,
    loadProjects,
    jump,
    refreshWorkspace,
    fail,
  });
  handlers.current = { syncState, selectSnapshot, loadProjects, jump, refreshWorkspace, fail };

  useDesktopEvents({
    handlers,
    appearance: state.system?.appearance,
    selected,
    archived,
    conversationId,
    pendingMessages,
    limit,
  });

  useDesktopShortcuts({
    selected,
    context: contextRef,
    set,
    stop: api.stop,
  });

  const targetMode = state.system?.target?.mode;
  useEffect(() => {
    if (targetMode === "toutiao" && !["writing", "overview"].includes(state.view))
      set({ view: "writing" });
  }, [targetMode, state.view]);

  function changeView(view: string) {
    if (view === desktopStore.get().view) return;
    if (canLeave()) {
      discardSource();
      set({ view });
    }
  }

  async function chooseWorkspace() {
    if (!canLeave()) return;
    const value = await api.workspace();
    if (!value) return;
    await selectSnapshot(value.target, false);
    await syncState();
    set((current) => ({ workspaceKey: current.workspaceKey + 1 }));
    await loadProjects();
  }

  async function importRoot(mode: "fanqie" | "toutiao") {
    if (!canLeave()) return;
    const value = await api.choose(mode);
    if (!value) return;
    await selectSnapshot(value, false);
    await syncState();
    set((current) => ({ workspaceKey: current.workspaceKey + 1 }));
    await loadProjects();
  }

  async function jump(target: Target | null, nextFocus: Focus = {}) {
    if (!target || !canLeave()) return;
    remember(target, nextFocus);
    await selectSnapshot({ ...target, focus: nextFocus }, true, true);
    set((current) => ({ workspaceKey: current.workspaceKey + 1, view: "writing", picker: false }));
  }

  async function sendText(value: string, snapshot: Focus = focused.current) {
    if (!selected.current) throw new Error("先选择作品或开始新作");
    if (archived.current !== undefined) throw new Error("当前查看的是旧对话，请先返回当前对话");
    set({ tab: "agent", drawer: true, error: "" });
    await api.send(value, selected.current, { ...snapshot });
  }

  async function submit(value: string) {
    const original = value;
    try {
      if (original.startsWith("/")) {
        const [name, ...parts] = original.slice(1).split(/\s+/);
        await command(name, parts.join(" "));
      } else await sendText(original);
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }

  async function newWork(mode: "fanqie" | "toutiao", note = "") {
    return startNewWork(
      {
        selected: selected.current,
        focus: focused.current,
        canLeave,
        selectSnapshot,
        sendText,
        set,
      },
      mode,
      note,
    );
  }

  async function deliver(action: string, note = "") {
    if (archived.current !== undefined) throw new Error("请先返回当前对话");
    if (action === "review" && state.context.hasCandidate)
      throw new Error("编辑审读当前工作稿；请先采纳要审读的候选稿");
    return deliverAction(
      {
        selected: selected.current,
        focus: focused.current,
        canLeave,
        selectSnapshot,
        sendText,
        set,
      },
      action,
      note,
    );
  }

  async function command(name: string, args = "") {
    if (archived.current !== undefined && name !== "新对话") throw new Error("请先返回当前对话");
    return runCommand({
      name,
      args,
      context: desktopStore.get().context,
      selected: selected.current,
      focus: focused.current,
      set,
      setChat: chatStore.set,
      sendText,
      deliver,
      jump,
      newWork,
      exportFile,
      loadView,
      changeView,
      canLeave,
      clearArchive: () => {
        archived.current = undefined;
      },
    });
  }

  async function exportFile(format: string) {
    if (!selected.current) return;
    const result = await api.export(selected.current, focused.current, format);
    if (result) chatStore.set({ phase: result.copied ? "标题与正文已复制" : "稿件已导出" });
  }

  return {
    get conversationId() {
      return conversationId.current;
    },
    state,
    system: state.system,
    selected: selected.current,
    focus: state.focus,
    context: state.context,
    input,
    archived,
    limit,
    set,
    setChat: chatStore.set,
    fail,
    syncState,
    loadProjects,
    loadView,
    selectSnapshot,
    jump,
    submit,
    sendText,
    newWork,
    deliver,
    command,
    exportFile,
    chooseWorkspace,
    importRoot,
    canLeave,
    canRestart,
    trackMethodEdit,
    trackSourceEdit,
    changeView,
    refreshWorkspace,
    stop: () => api.stop(selected.current || undefined),
  };
}

export type DesktopController = ReturnType<typeof useDesktopController>;
