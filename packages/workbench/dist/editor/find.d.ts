import type { TextHighlightRange } from "./TextSurface.js";
export type TextMatchRange = readonly [start: number, end: number];
/** Every occurrence of `query` as [start, end) offsets; the query is literal text, never a pattern. */
export declare function findMatches(text: string, query: string, matchCase?: boolean): TextMatchRange[];
/** Index of the first match starting at or after `offset`, wrapping to 0 past the last one. */
export declare function matchFrom(matches: readonly TextMatchRange[], offset: number): number;
/** Convert match offsets and active index into TextSurface highlight ranges. */
export declare function matchesToHighlights(matches: readonly TextMatchRange[], activeIndex: number): TextHighlightRange[];
//# sourceMappingURL=find.d.ts.map