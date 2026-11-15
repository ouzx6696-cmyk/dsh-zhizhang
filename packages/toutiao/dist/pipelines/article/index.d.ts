import type { PipelineDefinition } from "@zhizhang/core/pipeline";
import { type Infer } from "@zhizhang/core/schema";
import { type ClaimCandidate } from "../../domain/claims.js";
import type { ArticleStatus } from "../../domain/status.js";
import { type QaCheckResult } from "../../rules/bridge.js";
export declare const ArticlePipelineReq: import("@zhizhang/core/schema").Parser<{
    articleId: string;
    genre: string;
    driver: string;
    line: string | undefined;
    note: string | undefined;
    sourceText: string | undefined;
    sourceKind: "paste" | "file" | "classic" | undefined;
    draftCount: number | undefined;
    scriptsDir: string | undefined;
    profileDir: string | undefined;
    ledgerPath: string | undefined;
    recentOpenings: string[] | undefined;
    recentEndings: string[] | undefined;
}>;
export type ArticleReq = Infer<typeof ArticlePipelineReq>;
export interface TitleCandidate {
    text: string;
    motif: string;
}
export interface TitleMatrixOutput {
    main: TitleCandidate;
    alternatives: TitleCandidate[];
}
export interface BlueprintOutput {
    openingStyle: string;
    endingStyle: string;
    sections: Array<{
        heading: string;
        question: string;
        action: string;
    }>;
    extensionStart?: string;
}
export interface FactCheckOutput {
    claims: Array<{
        id: string;
        status: "supported" | "unsupported" | "unlocated";
        sourceId?: string;
        evidence?: string;
    }>;
}
export interface ReviewIssue {
    kind: "skeleton" | "ai-taste" | "fact" | "pacing";
    quote: string;
    issue: string;
    fix: string;
}
export interface ReviewOutput {
    issues: ReviewIssue[];
    summary: string;
}
export interface AntiGamingCounts {
    oralMarkers: number;
    headings: number;
}
export interface AntiGamingReport {
    before: AntiGamingCounts;
    after: AntiGamingCounts;
    oralDelta: number;
    headingDelta: number;
    warnings: string[];
}
export interface ArticlePipelineResult {
    articleId: string;
    title: string;
    draft: string;
    qa: QaCheckResult;
    claims: ClaimCandidate[];
    antigaming: AntiGamingReport;
    status: ArticleStatus;
}
export declare function validateTitleMatrix(candidates: Array<{
    text: string;
    motif: string;
}>, titleMax: number): {
    valid: Array<{
        text: string;
        motif: string;
    }>;
    dropped: string[];
};
export declare function filterChangedParagraphClaims(nextDraft: string, prevClaims: ClaimCandidate[]): {
    reused: ClaimCandidate[];
    toVerify: ClaimCandidate[];
};
export declare function countOralMarkersAndHeadings(text: string): AntiGamingCounts;
export declare function evaluateAntiGaming(beforeText: string, afterText: string): AntiGamingReport;
export declare function pickRotatedStyles(recentOpenings?: string[], recentEndings?: string[], availableOpenings?: readonly string[], availableEndings?: readonly string[]): {
    openingStyle: string;
    endingStyle: string;
};
export declare const articlePipeline: PipelineDefinition<ArticleReq, ArticlePipelineResult>;
//# sourceMappingURL=index.d.ts.map