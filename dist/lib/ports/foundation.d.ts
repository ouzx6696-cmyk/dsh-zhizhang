import { bodyTailOf, endingBodyOverlap } from "../domain/ending-consistency.js";
import { formatChapterOutcomeLine, resolveHappenedText } from "../domain/foundation-outcome.js";
export declare const extractBodyOutcome: typeof bodyTailOf;
export { endingBodyOverlap, resolveHappenedText };
export declare const FoundationPort: {
    id: string;
    extractBodyOutcome: typeof bodyTailOf;
    endingBodyOverlap: typeof endingBodyOverlap;
    resolveHappenedText: typeof resolveHappenedText;
    /**
     * Build a one-line happened entry. Returns empty if text is blank.
     */
    formatChapterOutcomeLine: typeof formatChapterOutcomeLine;
    /**
     * Append a short happened line for a chapter. Idempotent per chapterId marker.
     * Skips when text empty (caller should still remind).
     */
    appendHappened(dir: string, input: any): Promise<{
        meta: any;
        appended: boolean;
        line: string;
        reason: string;
        replaced?: undefined;
    } | {
        meta: any;
        appended: boolean;
        replaced: boolean;
        line: string;
        reason?: undefined;
    } | {
        meta: any;
        appended: boolean;
        line: string;
        reason?: undefined;
        replaced?: undefined;
    }>;
    /**
     * Candidate adoption updates working continuity; happened remains author material.
     */
    acceptReceiptLines(opts: any): string[];
};
