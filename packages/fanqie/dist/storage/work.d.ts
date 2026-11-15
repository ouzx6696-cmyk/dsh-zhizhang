import type { LockService } from "@zhizhang/core/lock";
import { type Infer } from "@zhizhang/core/schema";
export declare const WorkMetaSchema: import("@zhizhang/core/schema").Parser<{
    format: "zhizhang/1.3";
    id: string;
    title: string;
    created: string;
    profile: string;
    grade: "economy" | "standard" | "premium";
    settings: {
        requireEditorPass: boolean;
        targetWords: number;
        previousTextMode: "full" | "tail" | "auto";
    };
}>;
export type WorkMeta = Infer<typeof WorkMetaSchema>;
export declare function createWorkLayout(workPath: string, input: {
    id: string;
    title: string;
    profile?: string;
    grade?: "economy" | "standard" | "premium";
    nowIso: string;
}, lock: LockService): Promise<WorkMeta>;
export declare function readWorkMeta(workPath: string): Promise<WorkMeta>;
//# sourceMappingURL=work.d.ts.map