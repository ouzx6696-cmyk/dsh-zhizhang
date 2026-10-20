/** Client-only style diagnostics for AI-ish / lazy prose. Zero network. */
export type StyleLintCategory = "cliche_syntax" | "lazy_emotion" | "process_skip" | "slogan_ending";
export interface StyleLintHit {
    category: StyleLintCategory;
    start: number;
    end: number;
    match: string;
    hint: string;
}
/** Ranges of quoted dialogue that should not trigger narrative style rules. */
export declare function dialogueRanges(text: string): Array<[number, number]>;
/** Scan manuscript text; dialogue in “…” / 「…」 is exempt. */
export declare function lintStyle(text: string): StyleLintHit[];
export declare function summarizeStyleLint(hits: StyleLintHit[]): Record<StyleLintCategory, number>;
