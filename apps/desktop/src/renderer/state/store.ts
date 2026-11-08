import { createStore } from "./createStore";
import { useSyncExternalStore } from "react";
import type { Focus, Target } from "../../context";
import type { WorkspaceContext } from "../../renderer-contracts";
import type { DesktopApi } from "./desktop";

type Api = DesktopApi;
export type SystemState = Awaited<ReturnType<Api["state"]>>;
export type SystemModels = SystemState["models"];
type ProjectItem = Awaited<ReturnType<Api["projects"]>>[number];
export type ConversationItem = Awaited<ReturnType<Api["conversations"]>>[number];
type RunningItem = Awaited<ReturnType<Api["running"]>>[number];
export type ChatMessage = import("../../renderer-contracts").WriterMessage;
export type ConnectionResult =
  | { busy: true; error?: undefined; latency?: undefined; model?: undefined }
  | { busy?: false; error: string; latency?: undefined; model?: undefined }
  | { busy?: false; error?: undefined; latency: number; model: string }
  | null;

export type DesktopState = {
  onboarding: boolean | null;
  system: SystemState | null;
  target?: Target;
  /** 当前打开的作品范围（api.select 的回执）；控制器另有同值 ref 供事件回调同步读取。 */
  selected: Target | null;
  focus: Focus;
  context: WorkspaceContext;
  running: RunningItem[];
  tab: string;
  view: string;
  drawer: boolean;
  settingsOpen: boolean;
  projects: ProjectItem[];
  picker: boolean;
  palette: boolean;
  workspaceKey: number;
  wizardStep: number;
  wizardModels: SystemModels | null;
};

const initialState: DesktopState = {
  onboarding: null,
  system: null,
  selected: null,
  focus: {},
  context: {},
  running: [],
  tab: "agent",
  view: "writing",
  drawer: false,
  settingsOpen: false,
  projects: [],
  picker: false,
  palette: false,
  workspaceKey: 0,
  wizardStep: 0,
  wizardModels: null,
};

export const desktopStore = createStore<DesktopState>(initialState);

/** 只订阅组件用到的字段：选择结果按 Object.is 比较，未变化的组件不重渲染。 */
export function useDesktopSelector<T>(selector: (state: DesktopState) => T): T {
  return useSyncExternalStore(
    desktopStore.subscribe,
    () => selector(desktopStore.get()),
    () => selector(desktopStore.get()),
  );
}
