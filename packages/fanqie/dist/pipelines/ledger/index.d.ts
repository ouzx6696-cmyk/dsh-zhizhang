import type { PipelineDefinition, StageSpec } from "@zhizhang/core/pipeline";
import { type Infer } from "@zhizhang/core/schema";
import type { PendingItem } from "../../bible/types.js";
export declare const LedgerReq: import("@zhizhang/core/schema").Parser<{
    chapterId: string;
    position: number | undefined;
}>;
export type LedgerInput = Infer<typeof LedgerReq>;
declare const ExtractedDeltaSchema: import("@zhizhang/core/schema").Parser<{
    deltas: {
        quote: string;
        kind: "knowledge" | "state" | "entity" | "thread";
        targetId: string;
        name: string;
        detail: string;
        field: string | undefined;
        value: string | undefined;
        level: "不知" | "怀疑" | "误认" | "知情" | "公开" | undefined;
    }[];
}>;
export interface LedgerResult {
    chapterId: string;
    position: number;
    extractedCount: number;
    locatedCount: number;
    unlocatedCount: number;
    droppedCount: number;
    opsCount: number;
    pending: PendingItem[];
}
export declare const ledgerExtractStage: StageSpec<{
    chapterId: string;
    position: number;
    body: string;
}, Infer<typeof ExtractedDeltaSchema>>;
export declare const ledgerPipeline: PipelineDefinition<LedgerInput, LedgerResult>;
export {};
//# sourceMappingURL=index.d.ts.map