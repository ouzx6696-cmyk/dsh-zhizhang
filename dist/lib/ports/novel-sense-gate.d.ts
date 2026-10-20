/**
 * NovelSenseGate — soft sensor for 「不像一本小说」:
 * same-skeleton re-demo vs prev chapter, no book-debt at end, overly closed short-story ending.
 * Heuristics are humble (not a quality law). Default soft warn; strictNovel → deny.
 * Do NOT stack default hard deny with HumanFeelGate.
 */
import { type GateDecision } from "./types.js";
export type NovelSenseHitCode = "same_skeleton_redemo" | "no_book_debt" | "closed_short_story";
export interface NovelSenseHit {
    code: NovelSenseHitCode;
    text: string;
    evidence: string;
}
export interface NovelSenseAuditResult {
    hitCount: number;
    hits: NovelSenseHit[];
    summary: string;
}
export declare function auditNovelSense(text: string, opts?: {
    prevBody?: string | null;
}): NovelSenseAuditResult;
export declare function formatNovelSenseAudit(label: string, result: NovelSenseAuditResult): string;
export declare const NovelSenseGate: {
    audit: typeof auditNovelSense;
    evaluateAccept(opts: {
        body: string;
        prevBody?: string | null;
        strictNovel: boolean;
    }): GateDecision;
};
