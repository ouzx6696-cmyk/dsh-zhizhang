export type TaskEndReason = "cancelled" | "failed" | "done";
import type { ReactNode } from "react";
import type { Target, Focus } from "./context";

/** Facts consumed by the renderer, separate from Electron and SDK objects. */
export interface WorkspaceContext {
  kind?: "novel" | "article";
  outlineReady?: boolean;
  hasCandidate?: boolean;
  chapter?: { id: string; status?: string };
  article?: { status: string };
  candidate?: { id: string };
  review?: { verdict?: string };
  actions?: {
    saveParagraph?: () => void | Promise<void>;
    refresh?: () => void | Promise<void>;
  };
}
export interface TaskState {
  id?: string;
  name: string;
  completed: string[];
  current: string;
  waiting: string;
  tokens: number;
  cost: number;
  startedAt: number;
  endedAt?: number;
}
export interface UpdateStatus {
  state: "idle" | "checking" | "current" | "available" | "downloading" | "downloaded" | "error";

  message?: string;
  version?: string;
  percent?: number;
}
export interface WriterResult {
  kind: string;
  target: Target;
  focus: Focus;
  draftLabel?: string;
  summary: string;
  failed?: boolean;
}
export interface WriterMessage {
  role: string;
  content?: string | { type: string; text?: string }[];
  writerMessageId?: string;
  errorMessage?: string;
  details?: unknown;
  toolName?: string;
  isError?: boolean;
  customType?: string;
  display?: boolean;
  timestamp?: number;
}
export interface DesktopEvent {
  conversationId?: string;
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
    reason?: TaskEndReason | "manual" | "threshold" | "overflow";
    error?: string;
    taskId?: string;
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
  onView?: (view: string) => void;
  onReview?: () => void;
  onNewChapter?: () => void;
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  readOnly?: boolean;
  onContext: (context: WorkspaceContext) => void;
  onTarget: (target: Target & { focus?: Focus }) => void;
  onSourceEditState?: (state: SourceEditState | null) => void;
  onMethodEditState: (state: { dirty: boolean; saving: boolean }) => void;
}

export type SourceEditState = { dirty: boolean; saving: boolean; discard: () => void };
