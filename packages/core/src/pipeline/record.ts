import type { FormatVersion } from "../paths.js";
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
  format: FormatVersion;
  id: string;
  kind: string;
  target: { mode: string; path: string; subId?: string };
  request: unknown;
  state: RunState;
  stateHistory: StateHistoryEntry[];
  steps: StepRecord[];
  usage: UsageTotals;
  budget: BudgetConfig;
  created: string;
  updated: string;
}

export function emptyUsage(): UsageTotals {
  return { input: 0, cachedInput: 0, output: 0, cost: 0 };
}

export function addUsage(a: UsageTotals, b: Partial<UsageTotals>): UsageTotals {
  const cost = a.cost === null || b.cost === null ? null : a.cost + (b.cost ?? 0);
  return {
    input: a.input + (b.input ?? 0),
    cachedInput: a.cachedInput + (b.cachedInput ?? 0),
    output: a.output + (b.output ?? 0),
    cost,
  };
}
