import type { LockService } from "@zhizhang/core/lock";
import type { StyleContract } from "../bible/types.js";
import type { ClassifiedEdit, EditCategory } from "./classify.js";
export interface LearningPattern {
    signature: string;
    kind: EditCategory;
    condition: string;
    change: string;
    why: string;
    count: number;
    examples: Array<{
        before: string;
        after: string;
        chapter?: string;
    }>;
    promoted: boolean;
    updatedAt: string;
}
export interface LearningState {
    patterns: LearningPattern[];
}
export declare function createLearningStore(lock: LockService): {
    read: (workPath: string) => Promise<LearningState>;
    record: (workPath: string, edits: ClassifiedEdit[], meta?: {
        chapter?: string;
        nowIso?: string;
    }) => Promise<{
        state: LearningState;
        promotedRules: StyleContract["rules"];
    }>;
};
//# sourceMappingURL=store.d.ts.map