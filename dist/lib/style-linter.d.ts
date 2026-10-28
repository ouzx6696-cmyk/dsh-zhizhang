/** Deterministic prose signals for tools and local diagnostics; no model or network. */
/** Pair dialogue delimiters in one pass, including nested quotes and unmatched input. */
export declare function dialogueRanges(text: string): [number, number][];
export interface StyleHit {
    category: string;
    start: number;
    end: number;
    match: string;
    hint: string;
}
/** Merge rule cursors in document order; retain at most `limit` results while counting all hits. */
export declare function scanStyle(text: string, limit?: number, include?: (start: number, end: number) => boolean): {
    hits: StyleHit[];
    totalHits: number;
};
export declare function lintStyle(text: string): StyleHit[];
export declare function summarizeStyleLint(hits: any): {
    cliche_syntax: number;
    lazy_emotion: number;
    process_skip: number;
    slogan_ending: number;
};
