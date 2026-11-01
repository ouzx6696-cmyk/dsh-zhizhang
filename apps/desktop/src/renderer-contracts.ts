import type { ReactNode } from "react";
import type { Target, Focus } from "./context";

/** Facts consumed by the renderer, separate from Electron and SDK objects. */
export interface WorkspaceContext {
  target?: Target;
  focus?: Focus;
  kind?: "novel" | "article";
  dirty?: boolean;
  ready?: boolean;
  outlineReady?: boolean;
  hasCandidate?: boolean;
  chapter?: { id: string; status?: string };
  article?: { status: string };
  candidate?: { id: string };
  review?: { verdict?: string };
  actions?: {
    saveParagraph?: () => void | Promise<void>;
  };
}
export interface TaskState {
  name: string;
  completed: string[];
  current: string;
  waiting: string;
  tokens: number;
  cost: number;
  startedAt: number;
}
export interface UpdateStatus {
  state: "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "error";

  message?: string;
  version?: string;
  percent?: number;
}
export interface WriterMessage {
  role: string;
  content?: string | { type: string; text?: string }[];
  writerMessageId?: string;
  errorMessage?: string;
}
export interface DesktopEvent {
  key?: string;
  role?: "writer" | "editor" | "planner";
  target?: Target;
  navigate?: Target;
  selection?: Target & { focus?: Focus };
  focus?: Focus;
  running?: { target: Target; focus?: Focus; phase?: string; task?: TaskState }[];
  updates?: UpdateStatus;
  error?: string;
  refresh?: boolean;
  phase?: string;
  editor?: boolean;
  task?: TaskState;
  event?: {
    type: string;
    toolName?: string;
    aborted?: boolean;
    message?: WriterMessage;
    assistantMessageEvent?: { type: string; delta?: string };
  };
}

export interface WorkspaceProps {
  target: Target;
  view: string;
  agent: ReactNode;
  tab: string;
  setTab: (tab: string) => void;
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  readOnly?: boolean;
  onContext: (context: WorkspaceContext) => void;
  onTarget: (target: Target & { focus?: Focus }) => void;
  onMethodEditState: (state: { dirty: boolean; saving: boolean }) => void;
}
