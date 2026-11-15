import type { PipelineDefinition } from "@zhizhang/core/pipeline";
import { type Infer } from "@zhizhang/core/schema";
import { type GateReport, type ReviewResult } from "../chapter/index.js";
export declare const RevisePipelineReq: import("@zhizhang/core/schema").Parser<{
    chapterId: string;
    issues: {
        kind: "continuity" | "reader";
        quote: string;
        issue: string;
        fix: string;
    }[] | undefined;
    note: string | undefined;
}>;
export type ReviseReq = Infer<typeof RevisePipelineReq>;
export interface StandaloneReviseResult {
    chapterId: string;
    title: string;
    body: string;
    gate: GateReport;
    review: ReviewResult;
    editorPass: boolean;
    editorRejections: number;
}
export declare const revisePipeline: PipelineDefinition<ReviseReq, StandaloneReviseResult>;
//# sourceMappingURL=index.d.ts.map