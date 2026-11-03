/** Local prose statistics and Python rule results. Coordinates are UTF-16 offsets into the unchanged source. */
import { parseManuscript } from "./manuscript.js";
import { scanStyle } from "../style-linter.js";
import type { ContextBasis } from "./lifecycle.js";

export const DIAGNOSTIC_LIMITS = {
  bodyBytes: 400 * 1024,
  paragraphs: 4096,
  issues: 120,
  edits: 100,
} as const;

export interface DiagnosticSource {
  workIdentity: string;
  chapter: string;
  kind: "chapter" | "candidate";
  candidate?: string;
  targetRevision: string;
  bodyHash: string;
  contextHash: string;
  pace: string | null;
}
export interface ParagraphEdit {
  start: number;
  end: number;
  before: string;
  after: string;
}
interface DiagnosticIssue {
  id: string;
  category: string;
  start: number;
  end: number;
  match: string;
  hint: string;
  origin: "rule" | "statistic";
}
export interface CapturedDiagnosticSource {
  text: string;
  source: DiagnosticSource;
  basis: ContextBasis;
}

export class ParagraphLimitError extends RangeError {}

export async function analyzeManuscript(text: string) {
  const blocks = parseManuscript(text).filter((block) => block.kind === "p");
  if (blocks.length > DIAGNOSTIC_LIMITS.paragraphs)
    throw new ParagraphLimitError("段落数量超过完整扫描上限");
  // Build one offset-preserving string from eligible runs instead of one array entry per character.
  const pieces: string[] = [];
  let cursor = 0;
  const blank = (value: string) => value.replace(/[^\r\n]/g, " ");
  for (const block of blocks)
    for (const run of block.runs) {
      if (run.style === "code") continue;
      pieces.push(blank(text.slice(cursor, run.start)), text.slice(run.start, run.end));
      cursor = run.end;
    }
  pieces.push(blank(text.slice(cursor)));
  const ranges: { start: number; end: number }[] = [];
  for (const block of blocks)
    for (const run of block.runs) {
      if (run.style === "code") continue;
      const previous = ranges[ranges.length - 1];
      if (previous && previous.end === run.start) previous.end = run.end;
      else ranges.push({ start: run.start, end: run.end });
    }
  const scanned = await scanStyle(text, DIAGNOSTIC_LIMITS.issues, ranges);
  const narrative = pieces.join(""),
    maskedPieces: string[] = [];
  cursor = 0;
  for (const [start, end] of scanned.dialogueRanges) {
    maskedPieces.push(narrative.slice(cursor, start), blank(narrative.slice(start, end)));
    cursor = end;
  }
  maskedPieces.push(narrative.slice(cursor));
  const masked = maskedPieces.join("");
  let totalHits = scanned.totalHits;
  const issues: DiagnosticIssue[] = scanned.hits.map((hit) => ({
    ...hit,
    id: `rule-${hit.start}-${hit.end}-${hit.category}`,
    origin: "rule",
  }));
  const addStatistic = (start: number, match: string, id: string, hint: string) => {
    totalHits++;
    const end = start + match.length;
    const last = issues[issues.length - 1];
    if (
      issues.length === DIAGNOSTIC_LIMITS.issues &&
      (start > last.start || (start === last.start && end >= last.end))
    )
      return;
    let lo = 0,
      hi = issues.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1,
        issue = issues[mid];
      if (issue.start < start || (issue.start === start && issue.end <= end)) lo = mid + 1;
      else hi = mid;
    }
    issues.splice(lo, 0, {
      id: `${id}-${start}`,
      category: "rhythm",
      start,
      end,
      match,
      hint,
      origin: "statistic",
    });
    if (issues.length > DIAGNOSTIC_LIMITS.issues) issues.pop();
  };
  let sentenceCount = 0,
    min = Infinity,
    max = 0;
  for (const block of blocks) {
    const slice = masked.slice(block.start, block.end);
    let previousStart = "";
    for (const match of slice.matchAll(/(?:^|[。！？!?])\s*([\u4e00-\u9fff]{2,4})/g)) {
      if (match[1] === previousStart)
        addStatistic(
          block.start + match.index! + match[0].lastIndexOf(match[1]),
          match[1],
          "repeat",
          "相邻句起句重复：核对是否承担递进或人物声音；无作用时调整后一句组织。",
        );
      previousStart = match[1];
    }
    const phrases = new Map<string, number>(),
      reported = new Set<string>();
    for (const run of slice.matchAll(/[\u4e00-\u9fff]{4,}/g)) {
      for (let offset = 0; offset <= run[0].length - 4; offset++) {
        const phrase = run[0].slice(offset, offset + 4),
          position = run.index! + offset;
        const first = phrases.get(phrase);
        if (first === undefined) phrases.set(phrase, position);
        else if (position - first >= 4 && !reported.has(phrase)) {
          reported.add(phrase);
          addStatistic(
            block.start + position,
            phrase,
            "phrase",
            "段内短语重复：可能是口癖或修辞；若重复没有带来变化，可删减或重组。",
          );
        }
      }
    }
    for (const sentence of slice.split(/[。！？!?]/)) {
      const length = sentence.replace(/\s/g, "").length;
      if (length) {
        sentenceCount++;
        min = Math.min(min, length);
        max = Math.max(max, length);
      }
    }
  }
  return {
    issues,
    totalHits,
    scanComplete: true,
    limited: totalHits > DIAGNOSTIC_LIMITS.issues,
    summary: { sentenceCount, min: sentenceCount ? min : 0, max },
    blocks: blocks.map(({ start, end }) => ({ start, end })),
    mode: "quick" as const,
  };
}
