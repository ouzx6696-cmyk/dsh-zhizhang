import { AppError } from "../errors/app-error.js";
export const TRANSITIONS = {
    running: ["running", "paused", "failed", "awaiting-author", "cancelled"],
    paused: ["running", "failed", "cancelled"],
    failed: ["running", "cancelled"],
    "awaiting-author": ["applied", "discarded"],
    applied: [],
    discarded: [],
    cancelled: [],
};
export function transition(rec, to, reason, at, stage) {
    const allowed = TRANSITIONS[rec.state];
    if (!allowed.includes(to)) {
        throw new AppError("run.invalid_transition", `Invalid run state transition: ${rec.state} -> ${to}`, { from: rec.state, to, reason });
    }
    return {
        ...rec,
        state: to,
        updated: at,
        stateHistory: [...rec.stateHistory, { to, reason, stage, at }],
    };
}
