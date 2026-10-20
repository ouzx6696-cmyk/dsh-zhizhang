import type { WorkMeta } from "../types.js";
export interface AppendHappenedInput {
    chapterId: string;
    /** Short outcome line — ending and/or body tail; never invent long prose. */
    text: string;
    title?: string;
}
export interface AppendHappenedResult {
    meta: WorkMeta;
    appended: boolean;
    line: string;
    reason?: string;
}
export type HappenedSource = "ending" | "body_tail" | "empty";
export interface ResolveHappenedTextResult {
    text: string;
    source: HappenedSource;
    /** Soft warning when outline ending drifts from body ending. */
    warn?: string;
    bodyTail?: string;
}
/** Last ~1–2 sentences / up to maxLen chars from body — short outcome only. */
export declare function extractBodyOutcome(body: string, maxLen?: number): string;
/** Meaningful tokens (≥2 chars) from ending for overlap check. */
export declare function significantTokens(text: string): string[];
/** Ratio of ending tokens found in bodyTail (0–1). Empty ending → 1. */
export declare function endingBodyOverlap(ending: string, bodyTail: string): number;
/**
 * Choose short happened text: ending if it aligns with body tail; else body outcome.
 * Never invents long prose from body beyond extractBodyOutcome.
 */
export declare function resolveHappenedText(opts: {
    ending: string;
    body: string;
    /** Overlap below this → prefer body_tail (default 0.35). */
    minOverlap?: number;
}): ResolveHappenedTextResult;
export declare const FoundationPort: {
    id: "port.foundation";
    extractBodyOutcome: typeof extractBodyOutcome;
    endingBodyOverlap: typeof endingBodyOverlap;
    resolveHappenedText: typeof resolveHappenedText;
    /**
     * Build a one-line happened entry. Returns empty if text is blank.
     */
    formatChapterOutcomeLine(chapterId: string, title: string | undefined, text: string): string;
    /**
     * Append a short happened line for a chapter. Idempotent per chapterId marker.
     * Skips when text empty (caller should still remind).
     */
    appendHappened(dir: string, input: AppendHappenedInput): Promise<AppendHappenedResult>;
    /**
     * Soft receipt lines after candidate_accept — remind model to refresh 当前小说状态.
     */
    acceptReceiptLines(opts: {
        chapterId: string;
        title?: string;
        ending?: string;
        threads?: string;
        append?: AppendHappenedResult | null;
        /** ending | body_tail | empty */
        happenedSource?: HappenedSource;
        endingVsBodyWarn?: string;
    }): string[];
};
