import type { PipelineDefinition } from "@zhizhang/core/pipeline";
import { type Infer } from "@zhizhang/core/schema";
import { type ReviewIssue, type ReviewResult } from "../chapter/index.js";
export declare const ReviewPipelineReq: import("@zhizhang/core/schema").Parser<{
    chapterId: string;
    note: string | undefined;
}>;
export type ReviewReq = Infer<typeof ReviewPipelineReq>;
export interface StandaloneReviewResult {
    chapterId: string;
    title: string;
    continuityIssues: ReviewIssue[];
    review: ReviewResult;
}
export declare const reviewPipeline: PipelineDefinition<ReviewReq, StandaloneReviewResult>;
//# sourceMappingURL=index.d.ts.map