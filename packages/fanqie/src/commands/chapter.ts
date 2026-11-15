import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import {
  parseChapterMarkdown,
  serializeChapterMarkdown,
  type ChapterDocument,
  type ChapterFrontMatter,
} from "../domain/chapter.js";
import { assertCanFinalize, downgradeOnEdit, type ChapterStatus } from "../domain/status.js";
import { countChineseWords } from "../pipelines/chapter/index.js";
import { readWorkMeta } from "../storage/work.js";
import type { ChapterRowView } from "../view/snapshot.js";

function parseChapterPosition(id: string): number {
  const m = /(\d+)/.exec(id);
  return m ? Number.parseInt(m[1], 10) : 0;
}

export async function listChapters(workPath: string): Promise<ChapterRowView[]> {
  const dir = path.join(workPath, "chapters");
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return [];
    throw new AppError("storage.io", `无法读取章节目录：${dir}`, { dir });
  }

  const rows: ChapterRowView[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const id = file.slice(0, -3);
    const raw = await readTextIfExists(path.join(dir, file));
    if (raw === undefined) continue;
    const doc = parseChapterMarkdown(raw);
    rows.push({
      id: doc.meta.id || id,
      title: doc.meta.title || id,
      position: parseChapterPosition(doc.meta.id || id),
      status: doc.meta.status,
      wordCount: countChineseWords(doc.body),
      revision: doc.meta.revision,
    });
  }
  return rows.sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export async function readChapter(workPath: string, chapterId: string): Promise<ChapterDocument> {
  const filePath = path.join(workPath, "chapters", `${chapterId}.md`);
  const raw = await readTextIfExists(filePath);
  if (raw === undefined) {
    throw new AppError("input.not_found", `未找到章节：${chapterId}`, { chapterId });
  }
  const doc = parseChapterMarkdown(raw);
  if (!doc.meta.id) doc.meta.id = chapterId;
  return doc;
}

export async function saveChapter(
  workPath: string,
  input: {
    chapterId: string;
    title?: string;
    body: string;
    expectedRevision?: string;
    status?: ChapterStatus;
    outline?: Record<string, string>;
  },
  lock: LockService = createLockService(systemClock),
): Promise<ChapterDocument> {
  return lock.write({ kind: "work", path: workPath }, async () => {
    const filePath = path.join(workPath, "chapters", `${input.chapterId}.md`);
    const existingRaw = await readTextIfExists(filePath);
    const prev = existingRaw ? parseChapterMarkdown(existingRaw) : undefined;

    if (prev && input.expectedRevision && prev.meta.revision !== input.expectedRevision) {
      throw new AppError("storage.conflict", "章节版本已变更，请刷新后重试", {
        expected: input.expectedRevision,
        actual: prev.meta.revision,
      });
    }

    const bodyChanged = !prev || prev.body !== input.body;
    const nextStatus: ChapterStatus =
      input.status ??
      (prev ? (bodyChanged ? downgradeOnEdit(prev.meta.status) : prev.meta.status) : "drafted");
    const nextRevision = `rev-${sha256(input.body).slice(0, 8)}`;

    const meta: ChapterFrontMatter = {
      id: input.chapterId,
      title: input.title ?? prev?.meta.title ?? input.chapterId,
      status: nextStatus,
      revision: nextRevision,
      outline: input.outline ?? prev?.meta.outline,
      scenes: prev?.meta.scenes,
      review: prev?.meta.review,
      editorPass: bodyChanged ? false : prev?.meta.editorPass,
      editorRejections: prev?.meta.editorRejections,
    };

    const doc: ChapterDocument = { meta, body: input.body };
    await atomicWrite(filePath, serializeChapterMarkdown(doc));
    return doc;
  });
}

export async function reviewChapter(
  workPath: string,
  input: {
    chapterId: string;
    verdict: "pass" | "revise" | "reject";
    quotes?: string[];
    expectedRevision?: string;
  },
  lock: LockService = createLockService(systemClock),
): Promise<ChapterDocument> {
  return lock.write({ kind: "work", path: workPath }, async () => {
    const doc = await readChapter(workPath, input.chapterId);
    if (input.expectedRevision && doc.meta.revision !== input.expectedRevision) {
      throw new AppError("storage.conflict", "章节版本已变更，无法标记审读", {
        expected: input.expectedRevision,
        actual: doc.meta.revision,
      });
    }

    const round = (doc.meta.review?.round ?? 0) + 1;
    const updated: ChapterDocument = {
      meta: {
        ...doc.meta,
        status: "reviewed",
        review: {
          round,
          verdict: input.verdict,
          quotes: input.quotes ?? [],
          at: systemClock.iso(),
        },
        editorPass: input.verdict === "pass",
      },
      body: doc.body,
    };

    await atomicWrite(
      path.join(workPath, "chapters", `${input.chapterId}.md`),
      serializeChapterMarkdown(updated),
    );
    return updated;
  });
}

export async function finalizeChapter(
  workPath: string,
  input: { chapterId: string; expectedRevision?: string },
  lock: LockService = createLockService(systemClock),
): Promise<ChapterDocument> {
  return lock.write({ kind: "work", path: workPath }, async () => {
    const workMeta = await readWorkMeta(workPath);
    const doc = await readChapter(workPath, input.chapterId);
    if (input.expectedRevision && doc.meta.revision !== input.expectedRevision) {
      throw new AppError("storage.conflict", "章节版本已变更，无法定稿", {
        expected: input.expectedRevision,
        actual: doc.meta.revision,
      });
    }

    assertCanFinalize({
      status: doc.meta.status,
      requireEditorPass: workMeta.settings.requireEditorPass,
      editorPass: doc.meta.editorPass,
      editorRejections: doc.meta.editorRejections,
    });

    const updated: ChapterDocument = {
      meta: {
        ...doc.meta,
        status: "final",
        finalizedAt: systemClock.iso(),
      },
      body: doc.body,
    };

    await atomicWrite(
      path.join(workPath, "chapters", `${input.chapterId}.md`),
      serializeChapterMarkdown(updated),
    );
    return updated;
  });
}
