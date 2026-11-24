/**
 * 外壳动作：启动、选目标、写作文件夹、新建作品/文章、助手会话。
 * 动作只读写 store，不持有组件状态；组件经 useDesktop / useChat 订阅。
 */
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { canLeaveEdit, type EditorGuardSnapshot } from "@zhizhang/workbench/client";
import type { ModelsInput, PublicSettings, SettingsPatch } from "../../shared/settings";
import { bindingFor } from "../../shared/roles";
import type { Focus, SessionIntent, Target } from "../../shared/views";
import { askConfirm } from "./confirm";
import { chatStore, emptyChat } from "./chatStore";
import { desktop } from "./desktop";
import { desktopStore, scopeKey, type CreateKind, type DockTab } from "./store";

const set = desktopStore.set;

/** 写手（或其回落）已绑定到一条连接，助手与流水线才能调用模型。 */
export function modelReady(settings: PublicSettings | null): boolean {
  if (!settings) return false;
  const binding = bindingFor(settings.models.roles, "writer");
  if (!binding) return false;
  const connection = settings.models.connections.find((c) => c.id === binding.connection);
  return Boolean(connection && (connection.keyless || connection.configured));
}

// ── 未保存修改守卫 ───────────────────────────────────────────────────────────

let editor: EditorGuardSnapshot | null = null;

export function trackEditor(snapshot: EditorGuardSnapshot | null): void {
  editor = snapshot;
}

export function editorDirty(): boolean {
  return Boolean(editor && (editor.dirty || editor.saving));
}

export async function canLeave(): Promise<boolean> {
  const ok = await canLeaveEdit(
    editor,
    (message) => askConfirm(message),
    () => notify({ tone: "warning", text: C.shell.savingBlocked }),
  );
  if (ok && editor) {
    const current = editor;
    editor = null;
    current.discard();
  }
  return ok;
}

// ── 启动与外壳 ───────────────────────────────────────────────────────────────

export async function boot(): Promise<void> {
  set({ boot: "loading", bootError: "" });
  const app = await desktop.state();
  const params = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
  const forceOnboarding = params?.get("onboarding") === "1";
  const skipOnboarding = params?.get("autostart") === "1";
  const isElectron = typeof window !== "undefined" && Boolean(window.zhizhangBridge);
  const needsOnboarding = forceOnboarding
    ? true
    : skipOnboarding
      ? !app.workspace.configured
      : isElectron
        ? !app.workspace.configured || !modelReady(app.settings)
        : !app.workspace.configured;
  set({
    app,
    settings: app.settings,
    workspace: app.workspace,
    onboarding: needsOnboarding,
  });
  if (app.settingsIssue)
    notify({ tone: "warning", text: C.shell.settingsIssue, detail: app.settingsIssue.message });
  const [running] = await Promise.all([
    desktop.running(),
    app.workspace.configured ? refreshTargets() : Promise.resolve(),
  ]);
  set({ running, boot: "ready" });
  const last = app.recent[0];
  if (last && app.workspace.configured) await select(last.target).catch(() => undefined);
}

export async function refreshTargets(): Promise<void> {
  const workspace = desktopStore.get().workspace;
  set({ targets: workspace?.configured ? await desktop.targets() : [] });
}

export async function chooseWorkspace(): Promise<boolean> {
  if (!(await canLeave())) return false;
  const status = await desktop.chooseWorkspace();
  if (!status) return false;
  set({ workspace: status, selected: null, focus: {} });
  chatStore.set(emptyChat);
  await refreshTargets();
  return true;
}

export async function takeOverWorkspace(): Promise<void> {
  const owner = desktopStore.get().workspace?.owner;
  if (!owner || !(await askConfirm(C.shell.takeOverConfirm(owner)))) return;
  set({ workspace: await desktop.takeOverWorkspace(owner) });
}

export function openDock(tab: DockTab): void {
  set({ dockTab: tab, dockOpen: true });
}

export function openPipeline(chapter = ""): void {
  set({ dockTab: "pipeline", dockOpen: true, pipelineChapter: chapter });
}

export function openSettings(tab = desktopStore.get().settingsTab): void {
  set({ settingsOpen: true, settingsTab: tab });
}

export function startCreate(kind: CreateKind): void {
  set({ creating: kind });
}

// ── 目标选择 ─────────────────────────────────────────────────────────────────

export async function select(target: Target, focus: Focus = {}, guard = true): Promise<void> {
  const current = desktopStore.get().selected;
  if (current && scopeKey(current.target) === scopeKey(target)) {
    set({ focus });
    return;
  }
  if (guard && !(await canLeave())) return;
  const item = await desktop.select(target);
  set({ selected: item, focus, view: "writing", compare: null });
  await loadChat(item.target);
}

export async function createWork(input: {
  title: string;
  premise: string;
  grade: "economy" | "standard" | "premium";
}) {
  const root = desktopStore.get().workspace?.roots.fanqie;
  if (!root) return;
  const { workPath } = await desktop.workbench("fanqie.work.create", { root, ...input });
  await refreshTargets();
  set({ creating: null });
  await select({ mode: "fanqie", path: workPath });
}

export async function createArticle(input: { genre: string; driver: string }) {
  const root = desktopStore.get().workspace?.roots.toutiao;
  if (!root) return;
  const { articleDir } = await desktop.workbench("toutiao.article.create", { root, ...input });
  await refreshTargets();
  set({ creating: null });
  await select({ mode: "toutiao", path: articleDir });
}

// ── 设置 ─────────────────────────────────────────────────────────────────────

export async function saveSettings(patch: SettingsPatch): Promise<PublicSettings> {
  const settings = await desktop.saveSettings(patch);
  set({ settings });
  return settings;
}

export async function saveModels(input: ModelsInput): Promise<PublicSettings> {
  const settings = await desktop.saveModels(input);
  set({ settings });
  return settings;
}

export async function resetSettings(): Promise<void> {
  if (!(await askConfirm(C.settings.resetConfirm))) return;
  set({ settings: await desktop.resetSettings() });
}

// ── 助手会话 ─────────────────────────────────────────────────────────────────

function selectedTarget(): Target | null {
  return desktopStore.get().selected?.target ?? null;
}

export async function loadChat(target: Target, conversationId?: string): Promise<void> {
  const scope = scopeKey(target);
  chatStore.set({ ...emptyChat, scope });
  const [view, conversations] = await Promise.all([
    desktop.sessionView(target, conversationId ? { conversationId } : {}),
    desktop.conversations(target),
  ]);
  if (chatStore.get().scope !== scope) return;
  chatStore.set({
    conversationId: view.conversationId,
    messages: view.messages,
    total: view.total,
    busy: view.busy,
    stream: view.stream,
    thinkingStream: view.thinkingStream ?? "",
    task: view.task ?? null,
    conversations,
  });
}

let localId = 0;

export async function sendMessage(text: string, intent?: SessionIntent): Promise<boolean> {
  const target = selectedTarget();
  const value = text.trim();
  if (!target || !value) return false;
  const focus = desktopStore.get().focus;
  chatStore.set((chat) => ({
    busy: true,
    ended: null,
    messages: [
      ...chat.messages,
      { id: `local-${++localId}`, role: "user", text: value, at: Date.now() },
    ],
    total: chat.total + 1,
  }));
  try {
    const { conversationId } = await desktop.send(target, {
      text: value,
      focus,
      ...(intent ? { intent } : {}),
    });
    chatStore.set({ conversationId });
    return true;
  } catch (error) {
    chatStore.set({ busy: false });
    throw error;
  }
}

export async function stopAssistant(): Promise<void> {
  const target = selectedTarget();
  if (target) await desktop.stop(target);
}

export async function newConversation(): Promise<void> {
  const target = selectedTarget();
  if (!target) return;
  const item = await desktop.newConversation(target);
  await loadChat(target, item.id);
}

export async function openConversation(id: string): Promise<void> {
  const target = selectedTarget();
  if (target) await loadChat(target, id);
}

export async function refreshUsage(): Promise<void> {
  const target = selectedTarget();
  if (target) chatStore.set({ usage: await desktop.contextUsage(target) });
}

export async function compactConversation(): Promise<void> {
  const target = selectedTarget();
  if (!target || !(await askConfirm(C.agent.compactConfirm))) return;
  const result = await desktop.compact(target);
  notify({ tone: "success", text: C.agent.compacted(result.tokensBefore, result.tokensAfter) });
  await refreshUsage();
}
