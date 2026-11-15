import type { TextHighlightRange } from "./TextSurface.js";

/** Plain-text search shared by the source editor and the reader. */
const SYNTAX = /[.*+?^${}()|[\]\\/]/g;

export type TextMatchRange = readonly [start: number, end: number];

/** Every occurrence of `query` as [start, end) offsets; the query is literal text, never a pattern. */
export function findMatches(text: string, query: string, matchCase = false): TextMatchRange[] {
  if (!query) return [];
  const pattern = new RegExp(query.replace(SYNTAX, "\\$&"), matchCase ? "gu" : "giu");
  return Array.from(text.matchAll(pattern), (match) => [
    match.index ?? 0,
    (match.index ?? 0) + match[0].length,
  ]);
}

/** Index of the first match starting at or after `offset`, wrapping to 0 past the last one. */
export function matchFrom(matches: readonly TextMatchRange[], offset: number): number {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid][0] < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo < matches.length ? lo : 0;
}

/** Convert match offsets and active index into TextSurface highlight ranges. */
export function matchesToHighlights(
  matches: readonly TextMatchRange[],
  activeIndex: number,
): TextHighlightRange[] {
  return matches.map(([from, to], index) => ({
    from,
    to,
    kind: index === activeIndex ? "find-active" : "find",
  }));
}
