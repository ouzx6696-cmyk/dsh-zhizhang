/**
 * Audit body against outline promises.
 * ok=true when no warning/error findings (info-only still ok).
 * opts.lexicon 可传 per-work 质量词表（quality-lexicon.json 的 endingKeywords）覆盖默认题材词。
 */
export declare function auditPayoff(outline: any, body: string, opts?: any): {
    ok: boolean;
    warningCount: number;
    findings: ({
        code: string;
        severity: string;
        message: string;
        promise: string;
        evidence?: undefined;
    } | {
        code: string;
        severity: string;
        message: string;
        promise: string;
        evidence: string | undefined;
    } | {
        code: string;
        severity: string;
        message: string;
        evidence: string | undefined;
        promise?: undefined;
    })[];
    checked: {
        endingTokens: string[];
        endingHits: string[];
        endingMisses: string[];
        endingScore: number | null;
        speechPromise: boolean;
        breathReveal: boolean;
    };
};
export declare function formatPayoffAudit(label: string, result: any): string;
