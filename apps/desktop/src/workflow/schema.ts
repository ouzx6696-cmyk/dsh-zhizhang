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
/** Whitespace and quote-style insensitive form used to locate model quotations in real text. */
function loose(value: string) {
  return value
    .replace(/\s+/g, "")
    .replace(/[“”「」『』]/g, '"')
    .replace(/[‘’]/g, "'");
}
/**
 * Returns the exact substring of `body` the model meant by `quote`, tolerating whitespace and
 * quote-style drift; undefined when the quotation is not in the text.
 */
export function locate(body: string, quote: string): string | undefined {
  if (body.includes(quote)) return quote;
  const target = loose(quote);
  if (!target) return undefined;
  const chars = [...body],
    map: number[] = [];
  let flat = "";
  for (const [index, char] of chars.entries()) {
    const normal = loose(char);
    if (!normal) continue;
    flat += normal;
    for (let k = 0; k < normal.length; k++) map.push(index);
  }
  const at = flat.indexOf(target);
  if (at < 0) return undefined;
  return chars.slice(map[at], map[at + target.length - 1] + 1).join("");
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
export interface Outline {
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
export function outline(value: unknown): Outline {
  const r = jsonOutput(value);
  if (
    typeof r.targetWords !== "number" ||
    !Number.isInteger(r.targetWords) ||
    r.targetWords < 300 ||
    r.targetWords > 12000
  )
    throw new Error("目标字数须为 300–12000 的整数");
  return {
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
export function review(value: unknown, body: string, hash: string): Review {
  const r = jsonOutput(value);
  // The code binds the review to the body it sent; models are never asked to echo a 64-char hash.
  if (sha256(body) !== hash) throw new Error("审读未绑定当前正文指纹");
  const hard = list(r.hard, "硬伤", 5).map((raw) => {
    const i = record(raw),
      quote = locate(body, text(i.quote, "定位原文", 1000));
    if (quote === undefined) throw new Error("硬伤定位不是当前正文原文");
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
export function revised(value: unknown): Draft & { resolved: string[] } {
  const r = jsonOutput(value);
  return {
    ...draft(r),
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
