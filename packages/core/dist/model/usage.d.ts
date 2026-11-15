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
export declare function emptyUsageSummary(): UsageSummary;
export declare function addUsageEntry(acc: UsageSummary, entry: UsageEntry): UsageSummary;
export declare function summarizeUsage(entries: readonly UsageEntry[]): UsageSummary;
export declare function groupUsageByRole(entries: readonly UsageEntry[]): Record<string, UsageSummary>;
export declare function groupUsageByModel(entries: readonly UsageEntry[]): Record<string, UsageSummary>;
export interface UsageTracker {
    record(entry: UsageEntry): void;
    entries(): UsageEntry[];
    summary(): UsageSummary;
    byRole(): Record<string, UsageSummary>;
    byModel(): Record<string, UsageSummary>;
}
export declare function createUsageTracker(): UsageTracker;
export declare function appendUsageEntry(filePath: string, entry: UsageEntry): Promise<void>;
export declare function readUsageEntries(filePath: string): Promise<UsageEntry[]>;
//# sourceMappingURL=usage.d.ts.map