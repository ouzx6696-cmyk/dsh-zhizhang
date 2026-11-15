import type { PipelineDefinition, StageSpec } from "@zhizhang/core/pipeline";
import { type Infer } from "@zhizhang/core/schema";
import type { AuditFinding } from "../../bible/types.js";
export declare const HealthReq: import("@zhizhang/core/schema").Parser<{
    upToChapter: number;
}>;
export type HealthInput = Infer<typeof HealthReq>;
export interface HealthEditorReview {
    findings: AuditFinding[];
    summary: string;
    recommendations: string[];
}
export declare const healthEditorStage: StageSpec<{
    upToChapter: number;
    localFindings: AuditFinding[];
    chapterSummaries: string[];
}, HealthEditorReview>;
export interface HealthResult {
    upToChapter: number;
    localFindings: AuditFinding[];
    editorReview: HealthEditorReview;
    findings: AuditFinding[];
}
export declare const healthPipeline: PipelineDefinition<HealthInput, HealthResult>;
//# sourceMappingURL=index.d.ts.map