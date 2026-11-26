import { sha256 } from "@zhizhang/core/fs";

export interface EarlyChapterDoc {
  chapter: string;
  position: number;
  summary: string;
  body?: string;
}

export interface RetrievedChapterHit {
  doc: EarlyChapterDoc;
  score: number;
  matchedTerms: number;
}

export function tokenize2Grams(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!cleaned) return [];
  const tokens: string[] = [];
  for (const seg of cleaned.split(/\s+/)) {
    if (seg.length === 0) continue;
    if (seg.length === 1) {
      tokens.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) {
      tokens.push(seg.slice(i, i + 2));
    }
  }
  return tokens;
}

interface TokenizedDoc {
  length: number;
  tf: Map<string, number>;
}

const TOKEN_CACHE_MAX = 512;
const tokenCache = new Map<string, TokenizedDoc>();

function getTokenizedDoc(doc: EarlyChapterDoc): TokenizedDoc {
  const body = doc.body ?? "";
  const key = `${doc.chapter}:${doc.position}:${sha256(`${doc.summary}\0${body}`)}`;
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const terms = tokenize2Grams(`${doc.summary}\n${body}`);
  const tf = new Map<string, number>();
  for (const term of terms) {
    tf.set(term, (tf.get(term) ?? 0) + 1);
  }
  const entry: TokenizedDoc = { length: terms.length, tf };
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(key, entry);
  return entry;
}

export function retrieveEarlyChapters(
  query: string,
  docs: EarlyChapterDoc[],
  topK = 3,
): RetrievedChapterHit[] {
  if (docs.length === 0 || topK <= 0) return [];
  const queryTerms = tokenize2Grams(query);
  if (queryTerms.length === 0) return [];

  const uniqueQueryTerms = Array.from(new Set(queryTerms));
  const tokenizedDocs = docs.map((doc) => ({ doc, ...getTokenizedDoc(doc) }));

  const avgDl =
    tokenizedDocs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, tokenizedDocs.length);
  if (avgDl === 0) return [];

  const df = new Map<string, number>();
  for (const term of uniqueQueryTerms) {
    let count = 0;
    for (const d of tokenizedDocs) {
      if ((d.tf.get(term) ?? 0) > 0) count += 1;
    }
    df.set(term, count);
  }

  const k1 = 1.5;
  const b = 0.75;
  const N = tokenizedDocs.length;
  const hits: RetrievedChapterHit[] = [];

  for (const d of tokenizedDocs) {
    let score = 0;
    let matchedTerms = 0;
    for (const term of uniqueQueryTerms) {
      const freq = d.tf.get(term) ?? 0;
      if (freq === 0) continue;
      matchedTerms += 1;
      const docFreq = df.get(term) ?? 0;
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + (b * d.length) / avgDl));
      score += idf * tfNorm;
    }
    if (score > 0) {
      hits.push({ doc: d.doc, score, matchedTerms });
    }
  }

  return hits
    .sort(
      (a, bHit) =>
        bHit.score - a.score ||
        bHit.matchedTerms - a.matchedTerms ||
        bHit.doc.position - a.doc.position,
    )
    .slice(0, topK);
}
