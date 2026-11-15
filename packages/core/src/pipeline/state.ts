import type { PauseReason } from "../errors/codes.js";
import { AppError } from "../errors/app-error.js";

export type RunState =
  "running" | "paused" | "failed" | "awaiting-author" | "applied" | "discarded" | "cancelled";

export interface StateHistoryEntry {
  to: RunState;
  reason:
    | PauseReason
    | "start"
    | "stage"
    | "resume"
    | "retry"
    | "deliver"
    | "apply"
    | "discard"
    | "cancel"
    | "error";
  stage?: string;
  at: string;
}

export const TRANSITIONS: Record<RunState, readonly RunState[]> = {
  running: ["running", "paused", "failed", "awaiting-author", "cancelled"],
  paused: ["running", "failed", "cancelled"],
  failed: ["running", "cancelled"],
  "awaiting-author": ["applied", "discarded"],
  applied: [],
  discarded: [],
  cancelled: [],
};

export interface StatefulRunRecord {
  state: RunState;
  stateHistory: StateHistoryEntry[];
  updated: string;
}

export function transition<T extends StatefulRunRecord>(
  rec: T,
  to: RunState,
  reason: StateHistoryEntry["reason"],
  at: string,
  stage?: string,
): T {
  const allowed = TRANSITIONS[rec.state];
  if (!allowed.includes(to)) {
    throw new AppError(
      "run.invalid_transition",
      `Invalid run state transition: ${rec.state} -> ${to}`,
      { from: rec.state, to, reason },
    );
  }
  return {
    ...rec,
    state: to,
    updated: at,
    stateHistory: [...rec.stateHistory, { to, reason, stage, at }],
  };
}
