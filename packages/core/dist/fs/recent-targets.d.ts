import { type Infer } from "../schema/parse.js";
declare const RecentEntrySchema: import("../schema/parse.js").Parser<{
    mode: string;
    path: string;
    title: string | undefined;
    updatedAt: string;
}>;
export type RecentEntry = Infer<typeof RecentEntrySchema>;
export declare function loadRecentTargets(env?: NodeJS.ProcessEnv): Promise<RecentEntry[]>;
export declare function recordRecentTarget(entry: Omit<RecentEntry, "updatedAt">, nowIso: string, env?: NodeJS.ProcessEnv): Promise<RecentEntry[]>;
export {};
//# sourceMappingURL=recent-targets.d.ts.map