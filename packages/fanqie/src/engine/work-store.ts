import { shortId, exists, isFsError } from "../../../core/src/fsx.js";
import { errorText } from "../../../core/src/errors.js";

import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { EMPTY_FOUNDATION, SCHEMA_VERSION } from "./types.js";
import type { StoragePaths } from "./types.js";

import { NovelError } from "./errors.js";

import { atomicWrite, assertSafeAncestors, nowIso } from "./storage/primitives.js";
import { chaptersDir, readChapter } from "./storage/chapters.js";

import { withResourceLock } from "./storage/process-lock.js";
import {
  metaPath,
  normalizeFoundation,
  readWorkMeta,
  validateStoryPace,
  writeWorkMeta,
} from "./storage/work-meta.js";

/** 工具/工作台共用的建作输入；key 缺省时用 title 生成目录名。 */
export interface CreateWorkInput {
  key?: string;
  title: string;
  genre?: string;
  premise?: string;
}

export async function createWork(paths: StoragePaths, input: CreateWorkInput) {
  const key = slugify(input.key?.trim() || input.title);
  await assertSafeAncestors(path.join(paths.works, ".root-check"));
  await mkdir(paths.works, { recursive: true });
  let dir = "";
  let finalKey = "";
  // Reserve the directory atomically: even a directory without meta.json may contain user files.
  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? key : shortId(Array.from(key).slice(0, 51).join(""), 8);
    const proposed = workDir(paths, candidate);
    try {
      await mkdir(proposed);
      dir = proposed;
      finalKey = path.basename(proposed);
      break;
    } catch (err) {
      if (!isFsError(err, "EEXIST")) throw err;
    }
  }
  if (!dir)
    throw new NovelError("work_create_failed", "无法为作品分配独立目录，请检查作品根目录。");
  const stamp = nowIso();
  const meta = {
    schemaVersion: SCHEMA_VERSION,
    key: finalKey,
    title: input.title.trim(),
    genre: (input.genre ?? "").trim(),
    premise: (input.premise ?? "").trim(),
    foundation: EMPTY_FOUNDATION(),
    createdAt: stamp,
    updatedAt: stamp,
    chapters: [],
  };
  try {
    await mkdir(chaptersDir(dir), { recursive: true });
    await mkdir(candidatesDir(dir), { recursive: true });
    await atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
    await atomicWrite(
      ledgerPath(dir),
      JSON.stringify({ schemaVersion: SCHEMA_VERSION, workKey: finalKey, entries: [] }, null, 2) +
        "\n",
    );
  } catch (err) {
    throw new NovelError(
      "partial_work_create",
      `作品目录 ${dir} 已创建，但初始化未完成（${errorText(err)}）。原目录已保留，请核对后处理。`,
    );
  }
  return { meta, dir };
}

export async function resolveWorkDir(paths: StoragePaths, keyOrTitle: string) {
  const direct = workDir(paths, keyOrTitle);
  if (await exists(metaPath(direct))) return direct;
  const all = await listWorks(paths);
  const hit = all.find((w) => w.key === keyOrTitle || w.title === keyOrTitle);
  if (!hit) throw new NovelError("work_not_found", `找不到作品：${keyOrTitle}`);
  return workDir(paths, hit.key);
}

export async function setFoundation(dir: string, patch: Record<string, unknown>, options: { pace?: string } = {}) {
  const pace = validateStoryPace(options.pace);
  return withResourceLock(dir, async () => {
    const meta = await readWorkMeta(dir);
    if (pace !== undefined) meta.pace = pace;
    meta.foundation = normalizeFoundation({ ...meta.foundation, ...patch });
    await writeWorkMeta(dir, meta);
    return meta;
  });
}

/** Update a chapter outcome under the work lock, preserving all other author-written text. */
export async function appendHappenedLine(
  dir: string,
  chapterId: string,
  line: string,
  replace = false,
) {
  return withResourceLock(dir, async () => {
    const meta = await readWorkMeta(dir);
    const existing = meta.foundation.happened;
    const mark = `[${chapterId}]`;
    if (existing.includes(mark)) {
      if (!replace) return { meta, appended: false, line, reason: "already_recorded" };
      const lines = existing.split("\n");
      const positions = lines.flatMap((value, index) =>
        value.trimStart().startsWith(mark) ? [index] : [],
      );
      if (positions.length !== 1)
        return { meta, appended: false, line, reason: "ambiguous_record" };
      lines[positions[0]] = line;
      meta.foundation = normalizeFoundation({ ...meta.foundation, happened: lines.join("\n") });
      await writeWorkMeta(dir, meta);
      return { meta, appended: false, replaced: true, line };
    }
    const happened = existing.trim() ? `${existing.trim()}\n${line}` : line;
    meta.foundation = normalizeFoundation({ ...meta.foundation, happened });
    await writeWorkMeta(dir, meta);
    return { meta, appended: true, line };
  });
}

export async function assembleManuscript(dir: string, paths: StoragePaths, opts: { onlyFinal?: boolean; outputRel?: string } = {}) {
  return withResourceLock(dir, async () => {
    const meta = await readWorkMeta(dir);
    const chapters = [...meta.chapters].sort((a, b) => a.position - b.position);
    const parts = [`# ${meta.title}`, ""];
    if (meta.premise) parts.push(`> ${meta.premise}`, "");
    let words = 0;
    let included = 0;
    for (const ch of chapters) {
      if (opts.onlyFinal && ch.status !== "final" && ch.status !== "reviewed") continue;
      let record;
      try {
        record = await readChapter(dir, ch.id);
      } catch (err) {
        throw new NovelError(
          "assemble_chapter_unreadable",
          `章节 ${ch.id} 无法读取，未生成或覆盖成稿。请核对原文件：${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!record.body.trim()) continue;
      parts.push(`## ${record.title}`, "", record.body.trim(), "");
      words += record.wordCount;
      included += 1;
    }
    if (included === 0) throw new Error("没有可汇编的章节正文");
    const rel = opts.outputRel?.trim() || `manuscripts/${meta.key}.md`;
    if (path.isAbsolute(rel)) throw new Error("output 只能是相对路径");
    const out = resolveInside(paths.manuscripts, path.resolve(paths.base, rel));
    await mkdir(paths.manuscripts, { recursive: true });
    await mkdir(path.dirname(out), { recursive: true });
    resolveInside(await realpath(paths.manuscripts), await realpath(path.dirname(out)));
    await atomicWrite(out, parts.join("\n") + "\n");
    return { file: out, words, chapters: included };
  });
}
import { slugify, workDir, ledgerPath, candidatesDir } from "./storage/paths.js";
import { listWorks } from "./storage/projects.js";
import { resolveInside } from "../../../core/src/fsx.js";
export * from "./storage/paths.js";
export * from "./storage/projects.js";
export * from "./storage/candidates.js";
export * from "./storage/work-records.js";
export { readLedger, writeLedgerEntry } from "./storage/ledger.js";
export { atomicWrite, assertResourceId, countWords } from "./storage/primitives.js";
export {
  listChapters,
  readChapter,
  setOutline,
  updateChapter,
} from "./storage/chapters.js";
export { readWorkMeta, writeWorkMeta } from "./storage/work-meta.js";
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "./domain/constants.js";
