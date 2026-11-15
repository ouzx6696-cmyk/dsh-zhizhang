import fs from "node:fs/promises";
import path from "node:path";
import { classify } from "../errors/classify.js";
import { readTextIfExists } from "../fs/read.js";

export interface UsageEntry {
  at: string;
  runId?: string;
  stage?: string;
  role: string;
  connection: string;
  model: string;
  input: number;
  cachedInput: number;
  output: number;
  cost: number | null;
}

export interface UsageSummary {
  input: number;
  cachedInput: number;
  output: number;
  cost: number | null;
  calls: number;
}

export function emptyUsageSummary(): UsageSummary {
  return { input: 0, cachedInput: 0, output: 0, cost: 0, calls: 0 };
}

export function addUsageEntry(acc: UsageSummary, entry: UsageEntry): UsageSummary {
  const cost = acc.cost === null || entry.cost === null ? null : acc.cost + entry.cost;
  return {
    input: acc.input + entry.input,
    cachedInput: acc.cachedInput + entry.cachedInput,
    output: acc.output + entry.output,
    cost,
    calls: acc.calls + 1,
  };
}

export function summarizeUsage(entries: readonly UsageEntry[]): UsageSummary {
  let acc = emptyUsageSummary();
  for (const entry of entries) {
    acc = addUsageEntry(acc, entry);
  }
  return acc;
}

export function groupUsageByRole(entries: readonly UsageEntry[]): Record<string, UsageSummary> {
  const grouped: Record<string, UsageSummary> = {};
  for (const entry of entries) {
    const prev = grouped[entry.role] ?? emptyUsageSummary();
    grouped[entry.role] = addUsageEntry(prev, entry);
  }
  return grouped;
}

export function groupUsageByModel(entries: readonly UsageEntry[]): Record<string, UsageSummary> {
  const grouped: Record<string, UsageSummary> = {};
  for (const entry of entries) {
    const key = `${entry.connection}:${entry.model}`;
    const prev = grouped[key] ?? emptyUsageSummary();
    grouped[key] = addUsageEntry(prev, entry);
  }
  return grouped;
}

export interface UsageTracker {
  record(entry: UsageEntry): void;
  entries(): UsageEntry[];
  summary(): UsageSummary;
  byRole(): Record<string, UsageSummary>;
  byModel(): Record<string, UsageSummary>;
}

export function createUsageTracker(): UsageTracker {
  const items: UsageEntry[] = [];
  return {
    record(entry: UsageEntry) {
      items.push(entry);
    },
    entries() {
      return [...items];
    },
    summary() {
      return summarizeUsage(items);
    },
    byRole() {
      return groupUsageByRole(items);
    },
    byModel() {
      return groupUsageByModel(items);
    },
  };
}

export async function appendUsageEntry(filePath: string, entry: UsageEntry): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (err) {
    throw classify(err);
  }
}

export async function readUsageEntries(filePath: string): Promise<UsageEntry[]> {
  const raw = await readTextIfExists(filePath);
  if (!raw) return [];
  const entries: UsageEntry[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    entries.push(JSON.parse(trimmed) as UsageEntry);
  }
  return entries;
}
