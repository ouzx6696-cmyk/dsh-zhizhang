import type { PauseReason } from "../errors/codes.js";
export type RunState = "running" | "paused" | "failed" | "awaiting-author" | "applied" | "discarded" | "cancelled";
export interface StateHistoryEntry {
    to: RunState;
    reason: PauseReason | "start" | "stage" | "resume" | "retry" | "deliver" | "apply" | "discard" | "cancel" | "error";
    stage?: string;
    at: string;
}
export declare const TRANSITIONS: Record<RunState, readonly RunState[]>;
export interface StatefulRunRecord {
    state: RunState;
    stateHistory: StateHistoryEntry[];
    updated: string;
}
export declare function transition<T extends StatefulRunRecord>(rec: T, to: RunState, reason: StateHistoryEntry["reason"], at: string, stage?: string): T;
//# sourceMappingURL=state.d.ts.map