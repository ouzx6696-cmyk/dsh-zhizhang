/**
 * 写作层读作品：直接用引擎的存储层与作品选择逻辑（work 参数 → 本会话上次打开的作品 → 只有一部时用它）。
 * 这里只读；落盘一律走引擎工具。
 */
import { WriterError, type ToolExecution } from "../../core/src/tool.js";
import { bodyFingerprint } from "./review.js";
import { findChapter } from "./engine/storage/chapters.js";
import { readWorkMeta } from "./engine/storage/work-meta.js";
import { openWork as engineOpenWork } from "./engine/tools/context.js";
import { NovelError } from "./engine/errors.js";

type ChapterOutline = Partial<import("./engine/types.js").Outline>;

interface ChapterRow {
  id: string;
  title: string;
  position: number;
  status: string;
  wordCount?: number;
}

export interface ChapterRecord extends ChapterRow {
  outline: ChapterOutline;
  body: string;
  bodySha256: string;
}

interface WorkInfo {
  key: string;
  title: string;
  dir: string;
  chapters: ChapterRow[];
}

export { bodyFingerprint };

function rethrow(err: unknown): never {
  if (err instanceof NovelError) {
    const code = /not_found|不存在|没有/.test(`${err.code} ${err.message}`)
      ? "NOT_FOUND"
      : "INVALID_ARGS";
    throw new WriterError(code, err.message);
  }
  throw err;
}

function sortRows(rows: import("./engine/types.js").ChapterMeta[]): ChapterRow[] {
  return rows
    .map(({ id, title, position, status, wordCount }) => ({
      id,
      title,
      position,
      status,
      wordCount,
    }))
    .sort((a, b) => a.position - b.position);
}

async function workAt(dir: string): Promise<WorkInfo> {
  const meta = await readWorkMeta(dir);
  return { key: meta.key, title: meta.title, dir, chapters: sortRows(meta.chapters) };
}

/** 按长篇工具同样的规则选作品 */
export async function openWork(
  exec: ToolExecution,
  work?: string,
  workingDir?: string,
): Promise<WorkInfo> {
  try {
    const { dir } = await engineOpenWork(exec, {
      work: work || undefined,
      working_dir: workingDir || undefined,
    });
    return await workAt(dir);
  } catch (err) {
    rethrow(err);
  }
}

function findRow(work: WorkInfo, id: string): ChapterRow | undefined {
  return work.chapters.find((c) => c.id === id || c.title === id || String(c.position) === id);
}

export async function readChapter(work: WorkInfo, id: string): Promise<ChapterRecord> {
  const row = findRow(work, id);
  if (!row)
    throw new WriterError(
      "NOT_FOUND",
      `《${work.title}》没有这一章：${id}。现有：${work.chapters.map((c) => `${c.position}.${c.title}（${c.id}）`).join("、") || "无"}`,
    );
  let rec: Partial<import("./engine/types.js").Chapter>;
  try {
    rec = (await findChapter(work.dir, row.id)) ?? {};
  } catch (err) {
    rethrow(err);
  }
  const body = typeof rec.body === "string" ? rec.body : "";
  return {
    ...row,
    title: rec.title ?? row.title,
    status: rec.status ?? row.status,
    outline: rec.outline ?? {},
    body,
    bodySha256: bodyFingerprint(body),
  };
}

/** 解析章节选择：单章 id/序号，或 "3-5" 区间，或省略 = 全部 */
export function pickChapters(work: WorkInfo, spec?: string): ChapterRow[] {
  if (!spec?.trim()) return work.chapters;
  const s = spec.trim();
  const range = s.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
  if (range) {
    const a = Number(range[1]),
      b = Number(range[2]);
    const rows = work.chapters.filter(
      (c) => c.position >= Math.min(a, b) && c.position <= Math.max(a, b),
    );
    if (!rows.length) throw new WriterError("NOT_FOUND", `第 ${a}–${b} 章不存在`);
    return rows;
  }
  const ids = s.split(/[,，\s]+/).filter(Boolean);
  return ids.map((id) => {
    const row = findRow(work, id);
    if (!row) throw new WriterError("NOT_FOUND", `没有这一章：${id}`);
    return row;
  });
}
