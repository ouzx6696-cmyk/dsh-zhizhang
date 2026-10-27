import type { StoragePaths } from "../../types.js";
export declare const PLAN_RATIO_DEFAULT = 0.1;
export declare const PLAN_RATIO_MIN = 0.05;
export declare const PLAN_RATIO_MAX = 1;
export declare const PLAN_BATCH_DEFAULT = 30000;
export declare const PLAN_BATCH_MIN = 4000;
export declare const PLAN_BATCH_MAX = 100000;
/** 10% 不足这个字数时，Auto 直接全读（小书）。 */
export declare const PLAN_SMALL_BOOK_CHARS = 30000;
/** 估算：中文约 1.4 字/token；每批 5 分钟（含读 + 白描）。 */
export declare const PLAN_CHARS_PER_TOKEN = 1.4;
export declare const PLAN_MINUTES_PER_BATCH = 5;
export declare function buildPlan(input: any): {
    schemaVersion: number;
    sourceId: any;
    title: any;
    mode: string;
    ratio: number;
    totalChapters: any;
    totalChars: any;
    planChapters: any;
    planChars: any;
    batchChars: any;
    chapters: any;
    batches: {
        i: any;
        chapters: any;
        chars: any;
    }[];
    cursor: number;
    createdAt: string;
};
export declare function estimatePlan(plan: any): {
    tokens: number;
    batches: any;
    minutes: number;
    hours: number;
    chars: any;
    chapters: any;
    ratio: number;
};
export declare function planLabel(plan: any): string;
export declare function writePlan(paths: StoragePaths, plan: any, options?: {
    clearConfirm?: boolean;
    confirmToken?: string;
}): Promise<void>;
export declare function readPlan(paths: StoragePaths, sourceId: any): Promise<any>;
export declare function renderPlanMarkdown(plan: any): string;
export declare function deletePlan(paths: StoragePaths, sourceId: any): Promise<void>;
export declare function makeConfirmToken(): string;
/**
 * Full 闸留痕：estimate + 参数快照（batchChars/totalChapters/planChapters）。
 * confirm 时断言参数一致——作者同意的是回执上的数字，不是换参后的重建计划。
 */
export declare function writePendingConfirm(paths: StoragePaths, sourceId: any, token: any, estimate: any, params?: any): Promise<{
    sourceId: any;
    token: any;
    estimate: any;
    params: any;
    expiresAt: number;
    createdAt: string;
}>;
export declare function readPendingConfirm(paths: StoragePaths, sourceId: any): Promise<any>;
/** Full 闸：token 必须存在、未过期、来源一致，且建计划参数与回执一致（若有快照）。 */
export declare function assertFullConsent(paths: StoragePaths, sourceId: any, token: any, current?: any): Promise<any>;
export declare function clearPendingConfirm(paths: StoragePaths, sourceId: any): Promise<void>;
export declare function planProgress(plan: any, facts: any): {
    done: any;
    total: any;
    charsDone: any;
    cursor: number;
    batches: any;
    nextBatch: any;
};
/** 事实章号是否在计划内；不在则返回提示（不硬拒，允许作者手补）。 */
export declare function planMembership(plan: any, n: number): {
    inPlan: boolean;
    reason: any;
};
