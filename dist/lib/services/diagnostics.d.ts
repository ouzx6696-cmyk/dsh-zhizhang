import type { DiagnosticSource } from '../domain/diagnostics.js';
export declare const bodyHash: (text: string) => string;
export declare function diagnose(dir: string, value: unknown): Promise<{
    issues: import("../domain/diagnostics.js").DiagnosticIssue[];
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
    source: DiagnosticSource;
}>;
export declare function stageRevisionCandidate(dir: string, value: unknown): Promise<{
    candidateId: any;
    reused: boolean;
}>;
