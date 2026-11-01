import { useSyncExternalStore } from "react";
import type { Focus, Target } from "../../context";
import type { TaskState, WorkspaceContext } from "../../renderer-contracts";

type Api = typeof window.writerDesktop;
export type SystemState = Awaited<ReturnType<Api["state"]>>;
export type SystemModels = SystemState["models"];
export type ProjectItem = Awaited<ReturnType<Api["projects"]>>[number];
export type ConversationItem = Awaited<ReturnType<Api["conversations"]>>[number];
export type RunningItem = Awaited<ReturnType<Api["running"]>>[number];
export type ChatMessage = {
  role?: string;
  content?: any;
  writerMessageId?: string;
  errorMessage?: string;
  details?: any;
  toolName?: string;
  [key: string]: any;
};
export type ConnectionResult =
  | { busy: true; error?: undefined; latency?: undefined; model?: undefined }
  | { busy?: false; error: string; latency?: undefined; model?: undefined }
  | { busy?: false; error?: undefined; latency: number; model: string }
  | null;

export type DesktopState = {
  onboarding: boolean | null;
  system: SystemState | null;
  target?: Target;
  focus: Focus;
  context: WorkspaceContext;
  messages: ChatMessage[];
  stream: string;
  busy: boolean;
  phase: string;
  task: TaskState | null;
  running: RunningItem[];
  text: string;
  error: string;
  tab: string;
  view: string;
  drawer: boolean;
  settingsOpen: boolean;
  projects: ProjectItem[];
  picker: boolean;
  palette: boolean;
  query: string;
  workspaceKey: number;
  total: number;
  archive: number | undefined;
  archives: ConversationItem[];
  wizardStep: number;
  wizardModels: SystemModels | null;
  connectionResult: ConnectionResult;
};

const initialState: DesktopState = {
  onboarding: null,
  system: null,
  focus: {},
  context: {},
  messages: [],
  stream: "",
  busy: false,
  phase: "",
  task: null,
  running: [],
  text: "",
  error: "",
  tab: "agent",
  view: "writing",
  drawer: false,
  settingsOpen: false,
  projects: [],
  picker: false,
  palette: false,
  query: "",
  workspaceKey: 0,
  total: 0,
  archive: undefined,
  archives: [],
  wizardStep: 0,
  wizardModels: null,
  connectionResult: null,
};

class DesktopStore {
  state: DesktopState = initialState;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get = () => this.state;
  set = (patch: Partial<DesktopState> | ((state: DesktopState) => Partial<DesktopState>)) => {
    this.state = {
      ...this.state,
      ...(typeof patch === "function" ? patch(this.state) : patch),
    };
    for (const listener of this.listeners) listener();
  };
}

export const desktopStore = new DesktopStore();
export const useDesktop = () =>
  useSyncExternalStore(desktopStore.subscribe, desktopStore.get, desktopStore.get);
