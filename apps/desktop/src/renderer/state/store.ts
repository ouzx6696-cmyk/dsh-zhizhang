/** 应用外壳状态：一个 store，组件经 useDesktop 选择各自需要的字段。 */
import type { PublicSettings } from "../../shared/settings";
import type { AppStateView, Focus, RunningRow, Target, TargetItem, WorkspaceStatus } from "../../shared/views";
import { createStore, useStoreSelector } from "./createStore";

export type DockTab = "assistant" | "pipeline" | "chapter";
export type MainView = "writing" | "board";
export type SettingsTab = "models" | "engine" | "appearance" | "workspace" | "about";
export type CreateKind = "fanqie" | "toutiao";

/** 写作区数据变化的计数；收到 workspace.changed 时按范围加一，写作区据此重读。 */
export interface Revisions {
  rows: number;
  chapter: number;
  bible: number;
  article: number;
  profiles: number;
  library: number;
}

export interface DesktopState {
  boot: "loading" | "ready" | "error";
  bootError: string;
  app: AppStateView | null;
  settings: PublicSettings | null;
  workspace: WorkspaceStatus | null;
  targets: TargetItem[];
  selected: TargetItem | null;
  focus: Focus;
  running: RunningRow[];
  revisions: Revisions;
  view: MainView;
  dockTab: DockTab;
  dockOpen: boolean;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  onboarding: boolean;
  creating: CreateKind | null;
  /** 流水线面板请求预填的章节（来自写作区“发起流水线”）。 */
  pipelineChapter: string;
  /** 当前番茄作品的章节（右栏流水线选章、圣经巡检范围用）。 */
  chapters: { id: string; title: string }[];
}

export const initialRevisions: Revisions = { rows: 0, chapter: 0, bible: 0, article: 0, profiles: 0, library: 0 };

export const desktopStore = createStore<DesktopState>({
  boot: "loading",
  bootError: "",
  app: null,
  settings: null,
  workspace: null,
  targets: [],
  selected: null,
  focus: {},
  running: [],
  revisions: initialRevisions,
  view: "writing",
  dockTab: "assistant",
  dockOpen: true,
  settingsOpen: false,
  settingsTab: "models",
  onboarding: false,
  creating: null,
  pipelineChapter: "",
  chapters: [],
});

export function useDesktop<R>(selector: (state: DesktopState) => R): R {
  return useStoreSelector(desktopStore, selector);
}

/** 作用域键：同一目标（模式 + 路径 + 子项）同一个键。 */
export function scopeKey(target: Target | null | undefined): string {
  return target ? JSON.stringify([target.mode, target.path, target.subId ?? ""]) : "";
}

export function sameTarget(a: Target | null | undefined, b: Target | null | undefined): boolean {
  return scopeKey(a) === scopeKey(b);
}

/** 末级目录名（兼容 Windows 与 POSIX 分隔符）。 */
export function baseName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** 在父目录下拼接子目录，沿用父路径里的分隔符。 */
export function joinPath(parent: string, child: string): string {
  const sep = parent.includes("\\") && !parent.includes("/") ? "\\" : "/";
  return parent.replace(/[\\/]+$/, "") + sep + child;
}
