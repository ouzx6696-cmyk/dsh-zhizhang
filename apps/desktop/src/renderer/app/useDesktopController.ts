import { useEffect, useRef } from "react";
import { scopeId } from "../../context";
import type { Focus, Target } from "../../context";
import type { WorkspaceContext } from "../../renderer-contracts";
import { desktopStore, useDesktop, type ChatMessage } from "../state/store";
import { PREF, readPref } from "../../../../../packages/workbench/src/client/shared/prefs.js";
import { remember } from "../state/prefs";
import { runCommand } from "../features/commands/runCommand";
import { deliverAction, startNewWork } from "../features/agent/taskActions";

const api = window.writerDesktop;
const refresh = () => window.dispatchEvent(new Event("writer:refresh"));

export function useDesktopController() {
  const state = useDesktop();
  const set = desktopStore.set;
  const selected = useRef<Target | null>(null);
  const focused = useRef<Focus>({});
  const limit = useRef(80);
  const viewRequest = useRef(0);
  const pendingMessages = useRef<ChatMessage[] | null>(null);
  const input = useRef<HTMLTextAreaElement | null>(null);
  const archived = useRef<number | undefined>(undefined);
  const methodEdit = useRef({ dirty: false, saving: false });
  const contextRef = useRef<WorkspaceContext>(state.context);
  contextRef.current = state.context;

  function fail(error: unknown) {
    set({ error: error instanceof Error ? error.message : String(error) });
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
          ? !value.models.writer?.configured || !value.workspace
          : current.onboarding,
    }));
    if (value.notice) set({ error: value.notice });
    return value;
  }

  async function loadProjects() {
    set({ projects: await api.projects() });
  }

  async function loadView(target: Target, maximum = 80, old?: number) {
    const request = ++viewRequest.current,
      buffer: ChatMessage[] = [];
    pendingMessages.current = buffer;
    try {
      const value = await api.view(target, maximum, old);
      if (request !== viewRequest.current || scopeId(target) !== scopeId(selected.current))
        return;
      const known = new Set(value.messages.map((message) => message.writerMessageId)),
        extra = buffer.filter(
          (message) => !message.writerMessageId || !known.has(message.writerMessageId),
        );
      set({
        messages: [...value.messages, ...extra],
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
    const { focus: nextFocus = {}, ...target } = next,
      previous = selected.current;
    if (scopeId(previous) === scopeId(target)) {
      if (reopen) {
        await api.select(target);
        if (scopeId(selected.current) !== scopeId(target)) return;
        await syncState();
      }
      if (next.focus) setPosition(nextFocus);
      return;
    }
    setPosition(nextFocus);
    const preserve =
      !previous &&
      (target.mode === "fanqie"
        ? readPref(PREF.work) === (target.work || "")
        : readPref(PREF.ttRoot) === target.root);
    remember(target, nextFocus, preserve);
    selected.current = target;
    archived.current = undefined;
    limit.current = 80;
    set({
      archive: undefined,
      messages: [],
      stream: "",
      task: null,
      busy: false,
    });
    const chosen = persist ? await api.select(target) : target;
    if (scopeId(selected.current) !== scopeId(target)) return;
    selected.current = chosen;
    await syncState();
    await loadView(chosen);
    set({ archives: await api.conversations(chosen) });
  }

  useEffect(() => {
    void (async () => {
      const value = await syncState();
      if (value.target) await selectSnapshot(value.target, false);
      set({ running: await api.running() });
      await loadProjects();
    })().catch(fail);
  }, []);

  useEffect(() => {
    const appearance = state.system?.appearance;
    if (!appearance) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        appearance.theme === "system" ? (media.matches ? "dark" : "light") : appearance.theme;
      document.documentElement.dataset.font = appearance.font;
      document.documentElement.style.setProperty("--paper-font-size", appearance.fontSize + "px");
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [state.system?.appearance]);

  useEffect(() => {
    const unsubscribe = api.subscribe((value) => {
      if (value.running) set({ running: value.running });
      if (value.updates)
        set((current) => ({
          system: current.system ? { ...current.system, updates: value.updates! } : null,
        }));
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
        refresh();
        void loadProjects().catch(fail);
      }
      const event = value.event;
      if (!event) return;
      if (value.phase) set({ phase: value.phase });
      if (value.task && !value.editor) set({ task: { ...value.task } });
      if (value.editor) return;
      if (event.type === "agent_start") set({ busy: true, stream: "" });
      if (event.type === "compaction_start" || event.type === "auto_retry_start")
        set({ busy: true });
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta")
        set((current) => ({
          stream: current.stream + (event.assistantMessageEvent?.delta || ""),
        }));
      if (event.type === "message_end") {
        if (archived.current !== undefined) return;
        const message = event.message as ChatMessage | undefined;
        if (!message) return;
        if (pendingMessages.current) pendingMessages.current.push(message);
        else
          set((current) => ({
            messages: [...current.messages, message].slice(-limit.current),
            total: current.total + 1,
          }));
        if (message.role === "assistant") set({ stream: "" });
        if (message.errorMessage) set({ error: message.errorMessage });
      }
      if (event.type === "agent_settled") {
        set({
          busy: false,
          stream: "",
          phase: event.aborted ? "已停止，已保存结果保留" : "任务结束，等待你查看结果",
        });
        refresh();
      }
    });
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        set((current) => ({ palette: !current.palette, query: "" }));
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void contextRef.current.actions?.saveParagraph?.();
      }
      if ((event.ctrlKey || event.metaKey) && ["1", "2", "3"].includes(event.key)) {
        event.preventDefault();
        set({ tab: ["agent", "chapter", "methods"][Number(event.key) - 1], drawer: true });
      }
      if (event.key === "Escape") {
        if (state.palette) {
          set({ palette: false });
          return;
        }
        if (state.settingsOpen) {
          set({ settingsOpen: false });
          return;
        }
        if (state.busy && window.confirm("停止当前任务？已保存的稿件不会撤销。"))
          void api.stop(selected.current || undefined).catch(fail);
        else set({ drawer: false });
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [state.busy, state.palette, state.settingsOpen]);

  function trackMethodEdit(value: { dirty: boolean; saving: boolean }) {
    methodEdit.current = value;
  }

  function canLeave() {
    if (methodEdit.current.saving) {
      set({ error: "方法方案正在保存，请稍后再切换。" });
      return false;
    }
    const unsaved = [
      focused.current.dirty && "段落",
      methodEdit.current.dirty && "方法方案",
    ].filter(Boolean);
    return (
      !unsaved.length ||
      window.confirm(`当前${unsaved.join("和")}有未保存修改，离开将放弃这些修改。是否继续？`)
    );
  }

  async function chooseWorkspace() {
    if (!canLeave()) return;
    const value = await api.workspace();
    if (!value) return;
    await selectSnapshot(value.target, false);
    await syncState();
    set((current) => ({ workspaceKey: current.workspaceKey + 1 }));
    refresh();
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
    refresh();
  }

  async function sendText(value: string, snapshot: Focus = focused.current) {
    if (!selected.current) throw new Error("先选择作品或开始新作");
    if (archived.current !== undefined)
      throw new Error("当前查看的是旧对话，请先返回当前对话");
    await api.send(value, selected.current, { ...snapshot });
    set({ tab: "agent", drawer: true, error: "" });
  }

  async function send(event?: { preventDefault(): void }) {
    event?.preventDefault();
    if (!state.text.trim()) return;
    const original = state.text;
    try {
      if (original.startsWith("/")) {
        const [name, ...parts] = original.slice(1).split(/\s+/);
        await command(name, parts.join(" "));
      } else await sendText(original);
      set((current) => ({ text: current.text === original ? "" : current.text }));
    } catch (error) {
      fail(error);
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
    return runCommand({
      name,
      args,
      context: desktopStore.get().context,
      selected: selected.current,
      focus: focused.current,
      set,
      sendText,
      deliver,
      jump,
      newWork,
      exportFile,
      loadView,
      clearArchive: () => {
        archived.current = undefined;
      },
    });
  }

  async function exportFile(format: string) {
    if (!selected.current) return;
    const result = await api.export(selected.current, focused.current, format);
    if (result) set({ phase: result.copied ? "标题与正文已复制" : "稿件已导出" });
  }

  return {
    state,
    system: state.system,
    selected: selected.current,
    focus: state.focus,
    context: state.context,
    input,
    archived,
    limit,
    set,
    fail,
    syncState,
    loadProjects,
    loadView,
    selectSnapshot,
    jump,
    send,
    sendText,
    newWork,
    deliver,
    command,
    exportFile,
    chooseWorkspace,
    importRoot,
    canLeave,
    trackMethodEdit,
    stop: () => api.stop(selected.current || undefined),
  };
}

export type DesktopController = ReturnType<typeof useDesktopController>;
