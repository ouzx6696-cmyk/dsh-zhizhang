import type { RunState, StateHistoryEntry } from "./state.js";
export interface UsageTotals {
    input: number;
    cachedInput: number;
    output: number;
    cost: number | null;
}
export interface BudgetConfig {
    inputBudget: number;
    runBudget: number;
    moneyCap: number | null;
}
export interface StepRecord {
    id: string;
    role: string;
    status: "done" | "failed";
    methodHash?: string;
    omitted?: string[];
    notes?: string[];
    output?: unknown;
    usage: UsageTotals;
    startedAt: string;
    finishedAt: string;
}
export interface RunRecord {
    format: "zhizhang/1.3";
    id: string;
    kind: string;
    target: {
        mode: string;
        path: string;
        subId?: string;
    };
    request: unknown;
    state: RunState;
    stateHistory: StateHistoryEntry[];
    steps: StepRecord[];
    usage: UsageTotals;
    budget: BudgetConfig;
    created: string;
    updated: string;
}
export declare function emptyUsage(): UsageTotals;
export declare function addUsage(a: UsageTotals, b: Partial<UsageTotals>): UsageTotals;
//# sourceMappingURL=record.d.ts.map