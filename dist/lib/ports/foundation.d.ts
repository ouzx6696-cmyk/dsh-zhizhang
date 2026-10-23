/** Last ~1–2 sentences / up to maxLen chars from body — short outcome only. */
export declare function extractBodyOutcome(body: string, maxLen?: any): string;
/** Meaningful tokens (≥2 chars) from ending for overlap check. */
export declare function significantTokens(text: string): string[];
/** Ratio of ending tokens found in bodyTail (0–1). Empty ending → 1. */
export declare function endingBodyOverlap(ending: any, bodyTail: any): number;
/**
 * Choose short happened text: ending if it aligns with body tail; else body outcome.
 * Never invents long prose from body beyond extractBodyOutcome.
 */
export declare function resolveHappenedText(opts: any): {
    text: string;
    source: string;
    bodyTail: string | undefined;
    warn?: undefined;
} | {
    text: string;
    source: string;
    bodyTail?: undefined;
    warn?: undefined;
} | {
    text: string;
    source: string;
    bodyTail: string;
    warn: string;
};
export declare const FoundationPort: {
    id: string;
    extractBodyOutcome: typeof extractBodyOutcome;
    endingBodyOverlap: typeof endingBodyOverlap;
    resolveHappenedText: typeof resolveHappenedText;
    /**
     * Build a one-line happened entry. Returns empty if text is blank.
     */
    formatChapterOutcomeLine(chapterId: string, title: string, text: string): string;
    /**
     * Append a short happened line for a chapter. Idempotent per chapterId marker.
     * Skips when text empty (caller should still remind).
     */
    appendHappened(dir: string, input: any): Promise<{
        meta: any;
        appended: boolean;
        line: string;
        reason: string;
    } | {
        meta: any;
        appended: boolean;
        line: string;
        reason?: undefined;
    }>;
    /**
     * Soft receipt lines after candidate_accept — remind model to refresh 当前小说状态.
     */
    acceptReceiptLines(opts: any): string[];
};
