import type { PipelineDefinition, StageSpec } from "@zhizhang/core/pipeline";
import { type Infer } from "@zhizhang/core/schema";
export declare const ChapterPipelineReq: import("@zhizhang/core/schema").Parser<{
    chapterId: string;
    position: string | undefined;
    grade: "economy" | "standard" | "premium" | undefined;
    golden: "true" | "false" | undefined;
    note: string | undefined;
    targetWords: number | undefined;
}>;
export type ChapterReq = Infer<typeof ChapterPipelineReq>;
export interface DraftOutput {
    title: string;
    body: string;
}
export interface BeatsOutput {
    scenes: Array<{
        title: string;
        goal: string;
        conflict: string;
        hook?: string;
    }>;
}
export interface ReviewIssue {
    kind: "continuity" | "reader";
    quote: string;
    issue: string;
    fix: string;
}
export interface ReviewResult {
    verdict: "pass" | "revise" | "reject";
    issues: ReviewIssue[];
    summary: string;
}
export interface ScoreResult {
    score: number;
    strengths: string[];
    weaknesses: string[];
    summary: string;
}
export interface CompareResult {
    winner: "A" | "B" | "tie";
    reason: string;
}
export interface GateReport {
    passed: boolean;
    wordCount: number;
    reasons: string[];
    hits: string[];
}
export interface ChapterRunResult {
    title: string;
    body: string;
    beats: BeatsOutput;
    gate: GateReport;
    review: ReviewResult;
    editorPass: boolean;
    editorRejections: number;
}
export declare function draftCountForGrade(grade: "economy" | "standard" | "premium", golden: boolean): number;
export declare function countChineseWords(text: string): number;
export declare function parsePlainDraft(raw: string): DraftOutput;
export declare function gateDraft(draft: DraftOutput, opts?: {
    targetWords?: number;
    minRatio?: number;
    maxRatio?: number;
}): GateReport;
export declare function filterLocatedIssues(issues: ReviewIssue[], body: string): {
    value: ReviewIssue[];
    notes: string[];
};
export declare const beatsStage: StageSpec<{
    chapterId: string;
    outline: string;
    note?: string;
}, BeatsOutput>;
export declare const draftStage: StageSpec<{
    chapterId: string;
    beats?: BeatsOutput;
    note?: string;
}, DraftOutput>;
export declare function makeScoreStage(index: number): StageSpec<{
    title: string;
    body: string;
}, ScoreResult>;
export declare function makeCompareStage(label: string, aFirst: boolean): StageSpec<{
    A: DraftOutput;
    B: DraftOutput;
}, CompareResult>;
export declare const continuityStage: StageSpec<{
    chapterId: string;
    title: string;
    body: string;
}, {
    issues: ReviewIssue[];
}>;
export declare function makeReviewStage(round: number): StageSpec<{
    chapterId: string;
    round: number;
    title: string;
    body: string;
}, ReviewResult>;
export declare const reviewStage: StageSpec<{
    chapterId: string;
    round: number;
    title: string;
    body: string;
}, ReviewResult>;
export declare function makeReviseStage(round: number): StageSpec<{
    chapterId: string;
    round: number;
    draft: DraftOutput;
    issues: ReviewIssue[];
    note?: string;
}, DraftOutput>;
export declare const reviseStage: StageSpec<{
    chapterId: string;
    round: number;
    draft: DraftOutput;
    issues: ReviewIssue[];
    note?: string;
}, DraftOutput>;
export declare const chapterPipeline: PipelineDefinition<ChapterReq, ChapterRunResult>;
//# sourceMappingURL=index.d.ts.map