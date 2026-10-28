import type { ContextBasis } from './lifecycle.js';
export declare const DIAGNOSTIC_LIMITS: {
    readonly bodyBytes: number;
    readonly paragraphs: 4096;
    readonly issues: 120;
    readonly edits: 100;
};
export interface DiagnosticSource {
    workIdentity: string;
    chapter: string;
    kind: 'chapter' | 'candidate';
    candidate?: string;
    targetRevision: string;
    bodyHash: string;
    contextHash: string;
    pace: string | null;
}
export interface ParagraphEdit {
    start: number;
    end: number;
    before: string;
    after: string;
}
export interface DiagnosticIssue {
    id: string;
    category: string;
    start: number;
    end: number;
    match: string;
    hint: string;
    origin: 'rule' | 'statistic';
}
export interface CapturedDiagnosticSource {
    text: string;
    source: DiagnosticSource;
    basis: ContextBasis;
}
export declare class ParagraphLimitError extends RangeError {
}
export declare function analyzeManuscript(text: string): {
    issues: DiagnosticIssue[];
    totalHits: number;
    scanComplete: boolean;
    limited: boolean;
    summary: {
        sentenceCount: number;
        min: number;
        max: number;
    };
    blocks: {
        start: number;
        end: number;
    }[];
    mode: "quick";
};
