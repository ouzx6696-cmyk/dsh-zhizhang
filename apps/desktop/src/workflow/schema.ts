import {
  parsePursuitOutline,
  type PursuitOutline,
} from "../../../../packages/fanqie/src/engine/domain/pursuit";
import { isRecord } from "../../../../packages/core/src/parse";
import { sha256 } from "../../../../packages/core/src/fsx";
export const record = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new Error("阶段输出须为 JSON 对象");
  return value;
};
/** Escapes raw control characters that models often leave inside JSON strings (long Chinese prose). */
function escapeControlInStrings(source: string) {
  let out = "",
    inString = false,
    escaped = false;
  for (const char of source) {
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      else if (char === "\n") {
        out += "\\n";
        continue;
      } else if (char === "\r") {
        out += "\\r";
        continue;
      } else if (char === "\t") {
        out += "\\t";
        continue;
      }
    } else if (char === '"') inString = true;
    out += char;
  }
  return out;
}
/** First balanced top-level object, ignoring braces inside strings; undefined when none closes. */
function firstObject(source: string) {
  const start = source.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0,
    inString = false,
    escaped = false;
  for (let index = start; index < source.length; index++) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  return undefined;
}
/**
 * Stage answers are model text. Strict JSON first; then the fenced or embedded object with raw
 * newlines escaped. Anything else is a malformed answer and the stage retries.
 */
export function jsonOutput(value: unknown) {
  if (typeof value !== "string") return record(value);
  const text = value
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  try {
    return record(JSON.parse(text));
  } catch (error) {
    const candidate = firstObject(text);
    if (candidate === undefined) throw error;
    return record(JSON.parse(escapeControlInStrings(candidate)));
  }
}
/**
 * Comparison-only form used to locate model quotations in real text: NFKC (full-width digits and
 * punctuation), whitespace, quote style and book-title marks are ignored. Never sent to a model.
 */
function loose(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[《》〈〉]/g, "")
    .replace(/[“”「」『』＂"]/g, '"')
    .replace(/[‘’＇']/g, "'");
}
/** Escape sequences a model sometimes writes literally inside a JSON string ("\\n", "\\t"). */
function unescapeLiteral(value: string) {
  return value.replace(/\\[nrt]/g, " ");
}
/** Ellipses a model uses to elide part of a long quotation. */
const ELLIPSIS = /(?:…+|\.{3,}|。{3,}|⋯+)/;
interface Flat {
  chars: string[];
  flat: string;
  map: number[];
}
function flatten(body: string): Flat {
  const chars = [...body],
    map: number[] = [];
  let flat = "";
  for (const [index, char] of chars.entries()) {
    const normal = loose(char);
    if (!normal) continue;
    flat += normal;
    for (let k = 0; k < normal.length; k++) map.push(index);
  }
  return { chars, flat, map };
}
/**
 * Returns the exact substring of `body` the model meant by `quote`, tolerating whitespace,
 * full-width, quote-style, book-title-mark and literal-escape drift, and an elided quotation
 * ("甲……乙") matched segment by segment in order. Undefined when the quotation is not in the
 * text; the result is always an original span of `body`.
 */
export function locate(body: string, quote: string): string | undefined {
  if (body.includes(quote)) return quote;
  const segments = unescapeLiteral(quote)
    .split(ELLIPSIS)
    .map(loose)
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return undefined;
  // An elision joins real fragments; one-character fragments or a span far longer than the quoted
  // text would let almost any pair of words "match".
  if (segments.length > 1 && segments.some((segment) => [...segment].length < 2)) return undefined;
  const quoted = segments.reduce((sum, segment) => sum + segment.length, 0);
  const { chars, flat, map } = flatten(body);
  let from = 0,
    start = -1,
    end = -1;
  for (const segment of segments) {
    const at = flat.indexOf(segment, from);
    if (at < 0) return undefined;
    if (start < 0) start = at;
    end = at + segment.length - 1;
    from = at + segment.length;
  }
  if (segments.length > 1 && end - start + 1 > quoted * 4 + 200) return undefined;
  return chars.slice(map[start], map[end] + 1).join("");
}
/**
 * Names the quotation that could not be located, so a retry tells the model which item to fix.
 * Only reaches the model through the retry note; the first request is unchanged.
 */
export function unlocated(what: string, index: number, quote: string): Error {
  const chars = [...quote.replace(/\s+/g, " ").trim()];
  const shown = chars.length > 40 ? `${chars.slice(0, 40).join("")}…` : chars.join("");
  return new Error(`${what}（第 ${index + 1} 条：「${shown}」）`);
}
export function text(value: unknown, name: string, max = 60000): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${name} 须为非空文本且不超过 ${max} 字`);
  return value.trim();
}
export function list(value: unknown, name: string, maximum = 30): unknown[] {
  if (!Array.isArray(value) || value.length > maximum)
    throw new Error(`${name} 须为不超过 ${maximum} 项的数组`);
  return value;
}
export interface Outline extends PursuitOutline {
  title: string;
  pov: string;
  targetWords: number;
  locks: string;
  knowledge: string;
  synopsis: string;
  conflict: string;
  beats: string;
  ending: string;
}
export function outline(value: unknown, requirePursuit = false): Outline {
  const r = jsonOutput(value);
  if (
    requirePursuit &&
    [
      "function",
      "unit",
      "unitPos",
      "hookType",
      "pressure",
      "newTerms",
      "newCharacters",
      "threadsOpen",
      "threadsClose",
    ].some((key) => r[key] === undefined)
  )
    throw new Error("追读章纲缺少必填规划字段");
  if (
    typeof r.targetWords !== "number" ||
    !Number.isInteger(r.targetWords) ||
    r.targetWords < 300 ||
    r.targetWords > 12000
  )
    throw new Error("目标字数须为 300–12000 的整数");
  return {
    ...parsePursuitOutline(r),
    title: text(r.title, "章名", 100),
    pov: text(r.pov, "视角"),
    targetWords: r.targetWords,
    locks: text(r.locks, "锁定事实"),
    knowledge: text(r.knowledge, "知情边界"),
    synopsis: text(r.synopsis, "梗概"),
    conflict: text(r.conflict, "冲突"),
    beats: text(r.beats, "节拍"),
    ending: text(r.ending, "落点"),
  };
}
export interface Scene {
  purpose: string;
  conflict: string;
  information: string;
  change: string;
}
export function scenes(value: unknown): { scenes: Scene[] } {
  const rows = list(jsonOutput(value).scenes, "场景", 6);
  if (rows.length < 1) throw new Error("至少需要一个完整场景，不为凑数量机械拆场");
  return {
    scenes: rows.map((row) => {
      const r = record(row);
      return {
        purpose: text(r.purpose, "目的"),
        conflict: text(r.conflict, "冲突"),
        information: text(r.information, "信息增量"),
        change: text(r.change, "状态变化"),
      };
    }),
  };
}
export interface Draft {
  title: string;
  body: string;
}
export function draft(value: unknown): Draft {
  const r = jsonOutput(value);
  return { title: text(r.title, "标题", 100), body: text(r.body, "正文") };
}
export interface HardIssue {
  location: string;
  quote: string;
  impact: string;
  fix: string;
}
export interface Review {
  bodyHash: string;
  hard: HardIssue[];
  suggestions: string[];
}
export function review(value: unknown, body: string): Review {
  const r = jsonOutput(value);
  // The code binds the review to the body it sent; models are never asked to echo a 64-char hash.
  const hash = sha256(body);
  const hard = list(r.hard, "硬伤", 5).map((raw, index) => {
    const i = record(raw),
      asked = text(i.quote, "定位原文", 1000),
      quote = locate(body, asked);
    if (quote === undefined) throw unlocated("硬伤定位不是当前正文原文", index, asked);
    return {
      location: text(i.location, "位置"),
      quote,
      impact: text(i.impact, "读者影响"),
      fix: text(i.fix, "定向改法"),
    };
  });
  return {
    bodyHash: hash,
    hard,
    suggestions: list(r.suggestions, "建议").map((s) => text(s, "建议")),
  };
}
export interface PairVote {
  winner: "A" | "B" | "tie";
  reason: string;
  abandonA: string;
  abandonB: string;
}
export function pairVote(value: unknown): PairVote {
  const r = jsonOutput(value);
  if (!["A", "B", "tie"].includes(String(r.winner))) throw new Error("择优结果须为 A/B/tie");
  return {
    winner: r.winner as PairVote["winner"],
    reason: text(r.reason, "理由"),
    abandonA: text(r.abandonA, "A 弃读点"),
    abandonB: text(r.abandonB, "B 弃读点"),
  };
}
/** Resolve every edit against the original body, then apply disjoint spans from the end. */
export function patchedDraft(value: unknown, before: Draft): Draft {
  const r = jsonOutput(value);
  if (r.edits === undefined) return draft(r);
  const edits = list(r.edits, "局部修订", 20)
    .map((raw) => {
      const edit = record(raw),
        quote = locate(before.body, text(edit.quote, "修订原文", 10000));
      if (!quote) throw new Error("修订原文不在当前正文中");
      const start = before.body.indexOf(quote);
      if (before.body.indexOf(quote, start + 1) >= 0)
        throw new Error("修订原文出现多次，请提供唯一的完整段落");
      if (typeof edit.replacement !== "string") throw new Error("替换内容须为字符串");
      return { start, end: start + quote.length, replacement: edit.replacement };
    })
    .sort((a, b) => b.start - a.start);
  let body = before.body,
    boundary = body.length;
  for (const edit of edits) {
    if (edit.end > boundary) throw new Error("局部修订范围重叠");
    body = body.slice(0, edit.start) + edit.replacement + body.slice(edit.end);
    boundary = edit.start;
  }
  return { title: r.title === undefined ? before.title : text(r.title, "标题", 100), body };
}

export function revised(value: unknown, before: Draft): Draft & { resolved: string[] } {
  const r = jsonOutput(value);
  return {
    ...patchedDraft(r, before),
    resolved: list(r.resolved, "修订处理说明", 5).map((v) => text(v, "处理说明")),
  };
}

export function normalizeDraft(body: string) {
  return body
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(
      /[﹐﹑﹒﹔﹕﹖﹗]/g,
      (char) =>
        ({ "﹐": "，", "﹑": "、", "﹒": "。", "﹔": "；", "﹕": "：", "﹖": "？", "﹗": "！" })[
          char
        ] ?? char,
    )
    .trim();
}
