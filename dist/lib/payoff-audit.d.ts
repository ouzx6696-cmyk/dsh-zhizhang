/** Extract round/clock tokens and key content nouns from ending text. */
export declare function extractEndingTokens(ending: any): unknown[];
/**
 * Audit body against outline promises.
 * ok=true when no warning/error findings (info-only still ok).
 */
export declare function auditPayoff(outline: any, body: string, opts?: any): {
    ok: boolean;
    warningCount: number;
    findings: ({
        code: string;
        severity: string;
        message: string;
        promise: any;
        evidence: string;
    } | {
        code: string;
        severity: string;
        message: string;
        promise: any;
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
        endingTokens: unknown[];
        endingHits: unknown[];
        endingMisses: unknown[];
        speechPromise: boolean;
        breathReveal: boolean;
    };
};
export declare function formatPayoffAudit(label: string, result: any): string;
