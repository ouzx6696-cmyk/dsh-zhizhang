/** Ranges of quoted dialogue that should not trigger narrative style rules. */
export declare function dialogueRanges(text: string): number[][];
/** Scan manuscript text; dialogue in “…” / 「…」 is exempt. */
export declare function lintStyle(text: string): {
    category: string;
    start: number;
    end: number;
    match: string;
    hint: string;
}[];
export declare function summarizeStyleLint(hits: any): {
    cliche_syntax: number;
    lazy_emotion: number;
    process_skip: number;
    slogan_ending: number;
};
