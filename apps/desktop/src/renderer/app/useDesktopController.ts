import { errorText } from "../../../../../packages/core/src/errors.js";
import {
  COPY as viewCopy,
  formatDateTime,
  t as viewText,
} from "../../../../../packages/ui/src/copy.js";
import { dismissNotices, notify } from "../../../../../packages/ui/src/notify";
import { DEFAULT_HISTORY_LIMIT } from "../../history-options";
import { createDraftProtection } from "./draftProtection";
import { useDesktopEvents } from "./useDesktopEvents";
import { createRef, useEffect, useState } from "react";
import { scopeId, type Focus, type Target } from "../../context";
import type { WorkspaceContext } from "../../renderer-contracts";
import { desktopStore, useDesktopSelector, type ChatMessage } from "../state/store";
import { chatStore } from "../state/chatStore";
import { sameFields } from "../state/createStore";
import { navigateWorkspace, workspaceMounted } from "../state/navigation";
import { PREF, readPref } from "../../../../../packages/workbench/src/client/shared/prefs.js";
import { remember } from "../state/prefs";
import { runCommand } from "../../commands";
import { deliverAction, startNewWork } from "../features/agent/taskActions";
import { desktop } from "../state/desktop";
import { useDesktopShortcuts } from "./useDesktopShortcuts";
import { askConfirm } from "../state/confirm";

const api = desktop;
const set = desktopStore.set;

/** 上下文的动作是函数表：逐个比较函数引用，相同就不算变化。 */
function sameContext(a: WorkspaceContext, b: WorkspaceContext) {
  const { actions: left, ...restA } = a;
  const { actions: right, ...restB } = b;
  return (
    sameFields(restA, restB) && (left === right || (!!left && !!right && sameFields(left, right)))
  );
}

/**
 * 控制器只建一次：方法从 ref 与 store 现读最新状态，引用永远不变，
 * 传给子组件不会打破 memo。界面数据由组件经 useDesktopSelector 各取所需。
 */
function createDesktopController() {
  const selected: { current: Target | null } = { current: null };
  const focused: { current: Focus } = { current: {} };
  const limit = { current: DEFAULT_HISTORY_LIMIT };
  const pendingMessages: { current: ChatMessage[] | null } = { current: null };
  const conversationId: { current: string | undefined } = { current: undefined };
  const archived: { current: number | undefined } = { current: undefined };
  const input = createRef<HTMLTextAreaElement>();
  let viewRequest = 0,
    selectionRequest = 0;
  const draft = createDraftProtection(focused, (text) => notify({ tone: "warning", text }));
  const { canLeave, canRestart, discardSource, trackMethodEdit, trackSourceEdit } = draft;

  function fail(error: unknown, retry?: () => Promise<unknown>) {
    notify({
      tone: "danger",
      text: errorText(error),
      action: retry && {
        label: viewCopy.retry,
        run: () => retry().catch((next) => fail(next, retry)),
      },
    });
  }

  function refreshWorkspace() {
    void Promise.resolve(desktopStore.get().context.actions?.refresh?.()).catch(fail);
  }

  function setPosition(next: Focus) {
    if (sameFields(focused.current, next)) return;
    focused.current = next;
    set({ focus: next });
  }

  function setContext(context: WorkspaceContext) {
    if (!sameContext(desktopStore.get().context, context)) set({ context });
  }

  async function syncState() {
    const value = await api.state();
    set((current) => ({
      // 目标范围没变时沿用原对象：写作区收到的 target 引用稳定，memo 才有效。
      system:
        current.system?.target && scopeId(current.system.target) === scopeId(value.target)
          ? { ...value, target: current.system.target }
          : value,
      wizardModels: current.wizardModels || value.models,
      onboarding:
        current.onboarding === null
          ? !value.models.writer.configured || !value.workspace
          : current.onboarding,
    }));
    if (value.notice) notify({ tone: "warning", text: value.notice });
    return value;
  }

  async function loadProjects() {
    set({ projects: await api.projects() });
  }

  async function loadView(target: Target, maximum = DEFAULT_HISTORY_LIMIT, old?: number) {
    const request = ++viewRequest,
      buffer: ChatMessage[] = [];
    pendingMessages.current = buffer;
    try {
      const value = await api.view(target, maximum, old);
      if (request !== viewRequest || scopeId(target) !== scopeId(selected.current)) return;
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
    const request = ++selectionRequest;
    const { focus: nextFocus = {}, ...target } = next,
      previous = selected.current;
    if (target.mode === "toutiao" && nextFocus.article) target.article = nextFocus.article;
    if (scopeId(previous) === scopeId(target)) {
      if (reopen) {
        await api.select(target);
        if (request !== selectionRequest) return;
        await syncState();
      }
      if (next.focus) setPosition(nextFocus);
      return;
    }
    const chosen = persist ? await api.select(target) : target;
    if (request !== selectionRequest) return;
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
    set({ selected: chosen });
    // 主进程的 select 会改目标与占用状态，需要重读；启动时传入的正是刚读到的目标，主进程没有新变化。
    if (persist || scopeId(desktopStore.get().system?.target) !== scopeId(chosen))
      await syncState();
    const [, archives] = await Promise.all([loadView(chosen), api.conversations(chosen)]);
    chatStore.set({ archives });
  }

  async function changeView(view: string) {
    if (view === desktopStore.get().view || !(await canLeave())) return;
    discardSource();
    set({ view });
  }

  /** 换了写作根或作品目录：写作区换范围，必须重挂载。selectSnapshot 已同步过主进程状态。 */
  async function openRoot(choose: () => Promise<Target | null>) {
    if (!(await canLeave())) return;
    const value = await choose();
    if (!value) return;
    const reopened = scopeId(selected.current) === scopeId(value);
    await selectSnapshot(value, false);
    // 换了范围时 selectSnapshot 已重读主进程状态；重选同一目录只需补读一次设置。
    if (reopened) await syncState();
    set((current) => ({ workspaceKey: current.workspaceKey + 1 }));
    await loadProjects();
  }

  async function chooseWorkspace() {
    await openRoot(async () => (await api.workspace())?.target ?? null);
  }

  async function importRoot(mode: "fanqie" | "toutiao") {
    await openRoot(() => api.choose(mode));
  }

  /** 同一写作区内（换章节、候选稿、文章）就地切换，保留阅读位置与筛选；换作品才重挂载。 */
  async function jump(target: Target | null, nextFocus: Focus = {}) {
    if (!target || !(await canLeave())) return;
    // 作者已确认放弃未保存修改；先丢掉，就地切换时不再二次询问。
    discardSource();
    const inPlace = workspaceMounted(target);
    remember(target, nextFocus);
    await selectSnapshot({ ...target, focus: nextFocus }, true, true);
    set({ view: "writing", picker: false });
    if (!inPlace || !navigateWorkspace(target, nextFocus))
      set((current) => ({ workspaceKey: current.workspaceKey + 1 }));
  }

  async function sendText(value: string, snapshot: Focus = focused.current) {
    if (!selected.current) throw new Error("先选择作品或开始新作");
    if (archived.current !== undefined) throw new Error("当前查看的是旧对话，请先返回当前对话");
    set({ tab: "agent", drawer: true });
    dismissNotices("danger");
    await api.send(value, selected.current, { ...snapshot });
  }

  async function submit(value: string) {
    try {
      if (value.startsWith("/")) {
        const [name, ...parts] = value.slice(1).split(/\s+/);
        await command(name, parts.join(" "));
      } else await sendText(value);
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }

  const taskDependencies = () => ({
    selected: selected.current,
    focus: focused.current,
    canLeave,
    selectSnapshot,
    sendText,
    set,
  });

  async function newWork(mode: "fanqie" | "toutiao", note = "") {
    return startNewWork(taskDependencies(), mode, note);
  }

  async function deliver(action: string, note = "") {
    if (archived.current !== undefined) throw new Error("请先返回当前对话");
    if (action === "review" && desktopStore.get().context.hasCandidate)
      throw new Error("编辑审读当前工作稿；请先采纳要审读的候选稿");
    return deliverAction(taskDependencies(), action, note);
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
      canLeave,
      clearArchive: () => {
        archived.current = undefined;
      },
    });
  }

  /** 只读来自无法自动判定的残留锁时，由作者确认原处已关闭后接管。 */
  async function takeOverWorkspace() {
    const access = desktopStore.get().system?.access;
    if (!access?.readOnly) return;
    const { owner } = access;
    const message = viewText("topBarText19", {
      value0: owner.host,
      value1: owner.machine,
      value2: owner.pid,
      value3: formatDateTime(owner.at),
    });
    if (!(await askConfirm(message))) return;
    await api.takeOverWorkspace(owner.id);
    await syncState();
    notify({ tone: "success", text: viewCopy.topBarText20 });
  }

  async function exportFile(format: string) {
    if (!selected.current) return;
    const result = await api.export(selected.current, focused.current, format);
    if (result)
      notify({ tone: "success", text: result.copied ? "标题与正文已复制" : "稿件已导出" });
  }

  const actions = {
    get conversationId() {
      return conversationId.current;
    },
    input,
    archived,
    limit,
    set,
    setChat: chatStore.set,
    fail,
    notify,
    setPosition,
    setContext,
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
    takeOverWorkspace,
    canLeave,
    canRestart,
    trackMethodEdit,
    trackSourceEdit,
    changeView,
    refreshWorkspace,
    stop: () => api.stop(selected.current || undefined),
  };
  return { actions, refs: { selected, archived, conversationId, pendingMessages, limit } };
}

export type DesktopActions = ReturnType<typeof createDesktopController>["actions"];

export function useDesktopController(): DesktopActions {
  const [{ actions, refs }] = useState(createDesktopController);
  useDesktopEvents({ actions, ...refs });
  useDesktopShortcuts({ selected: refs.selected, stop: api.stop });
  const targetMode = useDesktopSelector((state) => state.system?.target?.mode);
  const view = useDesktopSelector((state) => state.view);
  useEffect(() => {
    if (targetMode === "toutiao" && !["writing", "overview"].includes(view))
      set({ view: "writing" });
  }, [targetMode, view]);
  return actions;
}
