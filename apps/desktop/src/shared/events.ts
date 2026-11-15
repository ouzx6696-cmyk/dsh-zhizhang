/**
 * 主进程 → 渲染层推送事件（单一通道 "zhizhang:event"）。
 * 渲染端按 kind 分派：`switch (event.kind)`，末尾以 never 穷尽检查兜底。
 */
import type { ErrorCode } from "@zhizhang/core/errors";
import type { CommandRefreshScope } from "@zhizhang/workbench/contract";
import type { ChatMessage, TaskEndReason, TaskState } from "./types.js";
import type {
  Focus,
  RunSummary,
  RunningRow,
  Target,
  UpdateStatus,
  WorkspaceStatus,
} from "./views.js";

export type SessionEvent =
  | { type: "busy"; busy: boolean }
  | { type: "text_delta"; delta: string }
  | { type: "message_end"; message: ChatMessage }
  | { type: "tool"; name: string; phase: "start" | "end"; isError?: boolean }
  | { type: "task"; task: TaskState }
  | { type: "compacted"; tokensBefore: number; tokensAfter: number }
  | { type: "end"; reason: TaskEndReason; error?: { code: ErrorCode; message: string } };

/** 写作区数据变化的范围，渲染层据此决定刷新哪一块。 */
export type ChangeScope = CommandRefreshScope;

export type NoticeCode = ErrorCode | "settings.reset" | "workspace.taken_over" | "backup.done";

export type DesktopEvent =
  | { kind: "run"; target: Target; run: RunSummary }
  | { kind: "running"; rows: RunningRow[] }
  | { kind: "session"; target: Target; conversationId: string; event: SessionEvent }
  | { kind: "workspace.changed"; target: Target; revision: string; scope: ChangeScope }
  | { kind: "workspace.status"; status: WorkspaceStatus }
  | { kind: "navigate"; target: Target; focus?: Focus }
  | { kind: "updates"; status: UpdateStatus }
  | { kind: "notice"; code: NoticeCode; message?: string; data?: Record<string, unknown> };
