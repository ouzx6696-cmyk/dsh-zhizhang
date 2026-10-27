export declare const COVERAGE_WEIGHTS: {
    ratio: number;
    quote: number;
    structure: number;
    dimensions: number;
};
export declare const STRUCTURE_WEIGHTS: {
    survey: number;
    plots: number;
    rhythms: number;
    characters: number;
};
export declare const AUTO_CONFIDENCE_CAP = 0.84;
export declare const REVIEW_THRESHOLD = 0.85;
export declare const COVERAGE_DIMENSION_MAX: number;
export declare function textStats(text: unknown): {
    chars: number;
    sentences: number;
    avgSentence: number;
    dialogueRatio: number;
};
export interface CoverageExtra {
    survey?: unknown;
    plots?: unknown;
    rhythms?: {
        points?: unknown;
    } | null;
    characters?: unknown;
    autoCap?: boolean;
}
export declare function computeCoverage(meta: any, facts: any[], modules: any[], quoteStats: {
    total: number;
    ok: number;
} | null | undefined, extra?: CoverageExtra): {
    facts: number;
    scope: number;
    ratio: number;
    quotePass: number;
    dimensions: number;
    structure: number;
    confidence: number;
    capped: boolean;
    needsReview: boolean;
};
