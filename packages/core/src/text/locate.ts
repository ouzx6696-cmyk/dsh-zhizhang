import type { MatchKeyResult, Para, QuoteHit } from "./types.js";

export function matchKey(text: string): MatchKeyResult {
  let key = "";
  const positions: number[] = [];
  for (const { segment: char, index: offset } of new Intl.Segmenter("und", {
    granularity: "grapheme",
  }).segment(text)) {
    const normalized = char
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[\p{White_Space}\p{P}\p{S}]/gu, "");
    key += normalized;
    for (let i = 0; i < normalized.length; i++) positions.push(offset);
  }
  return { key, toOrig: Int32Array.from(positions) };
}

function grams(text: string): Set<string> {
  const chars = [...matchKey(text).key];
  if (chars.length < 2) return new Set(chars);
  return new Set(chars.slice(1).map((char, i) => chars[i] + char));
}

export function similar(a: string, b: string): number {
  const left = grams(a),
    right = grams(b);
  const union = new Set([...left, ...right]);
  if (!union.size) return 0;
  return [...left].filter((value) => right.has(value)).length / union.size;
}

export function locateQuote(text: string, paras: Para[], ids: string[], quote: string): QuoteHit {
  const candidates = paras.filter((para) => ids.includes(para.id));
  const missing: QuoteHit = { located: false, score: 0 };
  const needle = matchKey(quote).key;
  if (!candidates.length || !needle) return missing;
  let best: QuoteHit = missing;
  for (const group of [candidates, paras.filter((para) => !ids.includes(para.id))]) {
    for (const para of group) {
      const body = text.slice(para.start, para.end);
      const exact = body.indexOf(quote);
      if (quote && exact >= 0)
        return {
          located: "exact",
          para: para.id,
          start: para.start + exact,
          end: para.start + exact + quote.length,
          score: 1,
          text: quote,
        };
      const keyed = matchKey(body);
      const index = keyed.key.indexOf(needle);
      if (index >= 0) {
        const start = para.start + keyed.toOrig[index];
        const last = para.start + keyed.toOrig[index + needle.length - 1];
        const tail = text.slice(last).match(/^.\p{M}*/u)?.[0] ?? "";
        const end = last + tail.length;
        return {
          located: "exact",
          para: para.id,
          start,
          end,
          score: 1,
          text: text.slice(start, end),
        };
      }
    }
    for (const para of group) {
      const body = text.slice(para.start, para.end);
      for (const sentence of body.matchAll(/[^。！？；…\n]+[。！？；…\n]*/gu)) {
        const score = similar(sentence[0], quote);
        if (score > best.score) {
          const start = para.start + sentence.index;
          best = {
            located: score >= 0.8 ? "fuzzy" : false,
            para: para.id,
            start,
            end: start + sentence[0].length,
            score,
            text: sentence[0],
          };
        }
      }
    }
    if (best.located) return best;
  }
  return { located: false, score: best.score };
}
