/** Python owns prose rules; this boundary validates offsets into the unchanged UTF-16 source. */
import { bridge, withTempFiles } from "../forge.js";
import { config } from "./runtime-config.js";
import { asObject, asString } from "./parse.js";
import { NovelError } from "./errors.js";
interface StyleHit {
  category: string;
  start: number;
  end: number;
  match: string;
  hint: string;
}
interface StyleStatistics {
  cjkChars: number;
  paragraphs: number;
  average: number;
  overlong: [number, number, string][];
  dialogueHits: number;
}
function numberField(row: Record<string, unknown>, key: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`文风检查字段无效：${key}`);
  return value;
}
function hit(value: unknown, text: string): StyleHit {
  const row = asObject(value, "文风检查命中"),
    start = numberField(row, "start"),
    end = numberField(row, "end");
  const match = asString(row, "match", { required: true, trim: false });
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    end < start ||
    end > text.length ||
    text.slice(start, end) !== match
  )
    throw new Error("文风检查坐标与源正文不符");
  return {
    start,
    end,
    match,
    category: asString(row, "category", { required: true }),
    hint: asString(row, "hint", { required: true }),
  };
}
export async function scanStyle(
  text: string,
  limit = 120,
  ranges?: readonly { start: number; end: number }[],
) {
  // A lone surrogate cannot be encoded for the Python bridge; say so instead of a script failure.
  // With the u flag a well-formed pair matches as one code point, so only lone halves hit.
  if (/\p{Cs}/u.test(text))
    throw new NovelError("bad_text", "正文含无法编码的字符（孤立代理项），请删除后再试");
  const request = { text, limit: Number.isFinite(limit) ? limit : null, ranges };
  const result = await withTempFiles(
    [{ name: "style.json", text: JSON.stringify(request) }],
    ([file]) => bridge(config.python, ["style", file], { timeoutMs: 30000 }),
  );
  if (
    !Array.isArray(result.hits) ||
    !Array.isArray(result.dialogueRanges) ||
    !Array.isArray(result.dialogueHits)
  )
    throw new Error("文风检查未返回命中或对白范围");
  const hits = result.hits.map((value) => hit(value, text));
  const dialogueRanges = result.dialogueRanges.map((value: unknown): [number, number] => {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      !value.every((n: unknown) => typeof n === "number" && Number.isInteger(n)) ||
      value[0] < 0 ||
      value[1] < value[0] ||
      value[1] > text.length
    )
      throw new Error("文风检查对白坐标无效");
    return [value[0], value[1]];
  });
  const totalHits = numberField(result, "totalHits");
  if (!Number.isInteger(totalHits) || totalHits < hits.length) throw new Error("文风检查总数无效");
  const stats = asObject(result.statistics, "正文统计");
  if (!Array.isArray(stats.overlong_paragraphs)) throw new Error("正文统计未返回长段位置");
  const overlong = stats.overlong_paragraphs.map((value: unknown): [number, number, string] => {
    if (
      !Array.isArray(value) ||
      value.length !== 3 ||
      typeof value[0] !== "number" ||
      typeof value[1] !== "number" ||
      typeof value[2] !== "string"
    )
      throw new Error("长段统计格式无效");
    return [value[0], value[1], value[2]];
  });
  const statistics: StyleStatistics = {
    cjkChars: numberField(stats, "cjk_chars"),
    paragraphs: numberField(stats, "para_count"),
    average: numberField(stats, "avg_para_chars"),
    overlong,
    dialogueHits: result.dialogueHits.length,
  };
  return { hits, totalHits, dialogueRanges, statistics };
}
export async function lintStyle(text: string) {
  return (await scanStyle(text, Infinity)).hits;
}
export function summarizeStyleLint(hits: readonly StyleHit[]) {
  const summary: Record<string, number> = {
    cliche_syntax: 0,
    lazy_emotion: 0,
    process_skip: 0,
    slogan_ending: 0,
  };
  for (const hit of hits) summary[hit.category] = (summary[hit.category] ?? 0) + 1;
  return summary;
}
