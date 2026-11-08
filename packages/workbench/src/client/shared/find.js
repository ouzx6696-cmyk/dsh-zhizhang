/** Plain-text search shared by the source editor and the reader. */
const SYNTAX = /[.*+?^${}()|[\]\\/]/g;

/** Every occurrence of `query` as [start, end) offsets; the query is literal text, never a pattern. */
export function findMatches(text, query, matchCase) {
  if (!query) return [];
  const pattern = new RegExp(query.replace(SYNTAX, "\\$&"), matchCase ? "gu" : "giu");
  return Array.from(text.matchAll(pattern), (match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

/** Index of the first match starting at or after `offset`, wrapping to 0 past the last one. */
export function matchFrom(matches, offset) {
  let lo = 0;
  let hi = matches.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (matches[mid][0] < offset) lo = mid + 1;
    else hi = mid;
  }
  return lo < matches.length ? lo : 0;
}
