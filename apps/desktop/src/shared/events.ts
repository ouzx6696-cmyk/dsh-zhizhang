import type { ErrorCode } from "@zhizhang/core/errors";
import type { Target } from "./ipc.js";

export type SessionEvent =
  | { type: "text_delta"; delta: string }
  | { type: "message_end"; message: unknown }
  | { type: "tool"; name: string; phase: "start" | "end"; isError?: boolean }
  | { type: "end"; reason: string };

export type DesktopEvent =
  | { kind: "run"; target: Target; record: { id: string; state: string; kind: string } }
  | { kind: "session"; target: Target; conversationId: string; event: SessionEvent }
  | { kind: "workspace.changed"; target: Target; revision: string; scope: "rows" | "chapter" | "bible" | "article" }
  | { kind: "navigate"; target: Target; focus?: string }
  | { kind: "notice"; code: ErrorCode; data?: unknown };
