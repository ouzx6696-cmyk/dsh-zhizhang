import type { LockService, ResourceKey } from "../lock/index.js";
export interface IntentWrite {
    path: string;
    beforeHash: string | null;
    after: string;
}
export interface Intent {
    format: "zhizhang/1.3";
    id: string;
    writes: IntentWrite[];
    meta: Record<string, string>;
}
export declare function commitIntent(journalDir: string, intent: Intent, lock: LockService, resource: ResourceKey): Promise<void>;
export declare function verifyBeforeHash(file: string, expected: string | null): Promise<boolean>;
//# sourceMappingURL=intent.d.ts.map