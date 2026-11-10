import { bridge, withTempFiles } from "../forge.js";
import { asObject } from "./parse.js";
import { sha256 } from "../../../core/src/fsx.js";

interface ReadingMetrics {
  number: number;
  characters: number;
  paragraphs: number;
  averageParagraph: number;
  shortParagraphShare: number;
  paragraphsOver120: number;
  dialogueShare: number;
  endingCharacters: number;
  styleHits: number;
  recapCharacters: number;
  termCounts: Record<string, number>;
  termDensity: Record<string, number>;
}
interface ReadingTargets {
  chapterLength: [number, number];
  averageParagraph: [number, number];
  shortParagraphShare: [number, number];
  dialogueShare: [number, number];
}
export interface ReadingBenchmark {
  schema: 1;
  sourceId: string;
  sourceHash: string;
  sampledChapters: number;
  targets: ReadingTargets;
  termDensityP90: Record<string, number>;
  opening?: OpeningTiming;
}
export interface OpeningTiming {
  anomalyRatio: number;
  abilityChapter: number;
  firstPayoffChapter: number;
}
export function parseOpeningTiming(value: unknown): OpeningTiming {
  const row = asObject(value),
    anomalyRatio = number(row.anomalyRatio, "异常位置"),
    abilityChapter = number(row.abilityChapter, "独有办法露出章"),
    firstPayoffChapter = number(row.firstPayoffChapter, "首次兑现章");
  if (
    anomalyRatio > 1 ||
    !Number.isSafeInteger(abilityChapter) ||
    abilityChapter < 1 ||
    !Number.isSafeInteger(firstPayoffChapter) ||
    firstPayoffChapter < 1
  )
    throw new Error("开篇时序：异常比例须为0–1，章号须为正整数");
  return { anomalyRatio, abilityChapter, firstPayoffChapter };
}
export const DEFAULT_READING_TARGETS: ReadingTargets = {
  chapterLength: [2000, 2400],
  averageParagraph: [20, 35],
  shortParagraphShare: [0.5, 0.75],
  dialogueShare: [0.22, 0.38],
};
function number(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    throw new Error(`阅读统计字段无效：${name}`);
  return value;
}
function densities(value: unknown) {
  return Object.fromEntries(
    Object.entries(asObject(value)).map(([key, value]) => [key, number(value, key)]),
  );
}
export async function readingMetrics(
  chapters: { number: number; body: string }[],
  python?: string,
): Promise<ReadingMetrics[]> {
  const result = await withTempFiles(
    [{ name: "reading.json", text: JSON.stringify({ chapters }) }],
    ([file]) => bridge(python, ["reading", file], { timeoutMs: 60000 }),
  );
  if (!Array.isArray(result.chapters) || result.chapters.length !== chapters.length)
    throw new Error("阅读统计未返回完整章节");
  return result.chapters.map((value: unknown, index: number) => {
    const r = asObject(value),
      length = asObject(r.paragraphLength);
    if (r.number !== chapters[index].number) throw new Error("阅读统计章号不匹配");
    return {
      number: chapters[index].number,
      characters: number(r.characters, "字数"),
      paragraphs: number(r.paragraphs, "段数"),
      averageParagraph: number(length.mean, "段均"),
      shortParagraphShare: number(r.shortParagraphShare, "短段"),
      paragraphsOver120: number(r.paragraphsOver120, "长段"),
      dialogueShare: number(r.dialogueShare, "对白"),
      endingCharacters: number(r.endingCharacters, "末段"),
      styleHits: number(r.styleHits, "雷达"),
      recapCharacters: number(r.recapCharacters, "回顾标记"),
      termCounts: densities(r.termCounts),
      termDensity: densities(r.termDensityPer10000),
    };
  });
}
function percentile(values: number[], fraction: number) {
  const ordered = [...values].sort((a, b) => a - b),
    at = (ordered.length - 1) * fraction,
    lower = Math.floor(at);
  return ordered[lower] + (ordered[Math.ceil(at)] - ordered[lower]) * (at - lower);
}
export function buildReadingBenchmark(
  sourceId: string,
  source: string,
  rows: ReadingMetrics[],
): ReadingBenchmark {
  if (!rows.length) throw new Error("对标书没有有效章节");
  const range = (
    metric: keyof Pick<
      ReadingMetrics,
      "characters" | "averageParagraph" | "shortParagraphShare" | "dialogueShare"
    >,
  ): [number, number] => {
    const values = rows.map((row) => row[metric]);
    return [percentile(values, 0.1), percentile(values, 0.9)];
  };
  return {
    schema: 1,
    sourceId,
    sourceHash: sha256(source),
    sampledChapters: rows.length,
    targets: {
      chapterLength: range("characters"),
      averageParagraph: range("averageParagraph"),
      shortParagraphShare: range("shortParagraphShare"),
      dialogueShare: range("dialogueShare"),
    },
    termDensityP90: Object.fromEntries(
      Object.keys(rows[0].termDensity).map((term) => [
        term,
        percentile(
          rows.map((row) => row.termDensity[term]),
          0.9,
        ),
      ]),
    ),
  };
}
export function parseReadingBenchmark(value: unknown): ReadingBenchmark {
  const r = asObject(value),
    raw = asObject(r.targets),
    targets = { ...DEFAULT_READING_TARGETS };
  if (
    r.schema !== 1 ||
    typeof r.sourceId !== "string" ||
    typeof r.sourceHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(r.sourceHash)
  )
    throw new Error("对标书设置无效");
  for (const key of Object.keys(targets) as (keyof ReadingTargets)[]) {
    const range = raw[key];
    if (!Array.isArray(range) || range.length !== 2) throw new Error("对标区间无效");
    const low = number(range[0], key),
      high = number(range[1], key);
    if (low > high || ((key === "dialogueShare" || key === "shortParagraphShare") && high > 1))
      throw new Error("对标区间顺序无效");
    targets[key] = [low, high];
  }
  const sampledChapters = number(r.sampledChapters, "样本数");
  if (!Number.isSafeInteger(sampledChapters) || sampledChapters < 1)
    throw new Error("对标样本数无效");
  return {
    schema: 1,
    sourceId: r.sourceId,
    sourceHash: r.sourceHash,
    sampledChapters,
    targets,
    termDensityP90: densities(r.termDensityP90),
    ...(r.opening === undefined ? {} : { opening: parseOpeningTiming(r.opening) }),
  };
}
/** Warnings describe measurable shape; they do not label prose as AI or deny adoption. */
export function readingWarnings(
  row: ReadingMetrics,
  targets: ReadingTargets,
  targetWords: number,
  density?: Record<string, number>,
) {
  const warnings: string[] = [];
  const check = (label: string, value: number, range: [number, number]) => {
    if (value < range[0] || value > range[1])
      warnings.push(
        `${label} ${value.toFixed(2)}，参考区间 ${range[0].toFixed(2)}–${range[1].toFixed(2)}`,
      );
  };
  check(
    "章长",
    row.characters,
    targetWords > 0 ? [targetWords * 0.8, targetWords * 1.25] : targets.chapterLength,
  );
  check("段均", row.averageParagraph, targets.averageParagraph);
  check("短段占比", row.shortParagraphShare, targets.shortParagraphShare);
  check("对白占比", row.dialogueShare, targets.dialogueShare);
  if (row.paragraphsOver120) warnings.push(`有${row.paragraphsOver120}段超过120字`);
  if (row.recapCharacters > 150) warnings.push("开头含回顾标记且首段超过150字，请核对接续");
  for (const [term, count] of Object.entries(row.termCounts))
    if (count > 1) warnings.push(`${term}本章出现${count}次，请核对是否机械重复`);
  if (row.endingCharacters > 30) warnings.push("章末段超过30字");
  if (density)
    for (const [term, value] of Object.entries(row.termDensity))
      if (density[term] !== undefined && value > density[term])
        warnings.push(
          `${term}每万字密度${value.toFixed(2)}，高于对标样本p90 ${density[term].toFixed(2)}；仅作回看`,
        );
  return warnings;
}
