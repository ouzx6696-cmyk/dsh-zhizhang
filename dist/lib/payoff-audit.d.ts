/**
 * Deterministic chapter payoff audit: outline promises vs body.
 * Read-only heuristics — never rewrites prose.
 */
import type { Outline } from "./types.js";
export type PayoffSeverity = "info" | "warning" | "error";
export interface PayoffFinding {
    code: string;
    severity: PayoffSeverity;
    message: string;
    /** Outline / promise side evidence */
    promise?: string;
    /** Body evidence quote */
    evidence?: string;
}
export interface PayoffAuditResult {
    ok: boolean;
    warningCount: number;
    findings: PayoffFinding[];
    checked: {
        endingTokens: string[];
        endingHits: string[];
        endingMisses: string[];
        speechPromise: boolean;
        breathReveal: boolean;
    };
}
/** Extract round/clock tokens and key content nouns from ending text. */
export declare function extractEndingTokens(ending: string): string[];
/**
 * Audit body against outline promises.
 * ok=true when no warning/error findings (info-only still ok).
 */
export declare function auditPayoff(outline: Outline, body: string, opts?: {
    premise?: string;
    title?: string;
}): PayoffAuditResult;
export declare function formatPayoffAudit(label: string, result: PayoffAuditResult): string;
