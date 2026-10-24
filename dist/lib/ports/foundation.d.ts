import { bodyTailOf, endingBodyOverlap } from "../domain/ending-consistency.js";
/** Last ~1–2 sentences / up to maxLen chars from body — short outcome only.（实现移至 domain） */
export declare const extractBodyOutcome: typeof bodyTailOf;
export { endingBodyOverlap };
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
    extractBodyOutcome: typeof bodyTailOf;
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
