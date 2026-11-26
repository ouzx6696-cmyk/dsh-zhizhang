import fs from "node:fs/promises";
import path from "node:path";
import { systemClock, type Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, resolveInsideAsync, sha256 } from "@zhizhang/core/fs";
import { commitIntent, type IntentWrite } from "@zhizhang/core/journal";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { serializeChapterMarkdown, type ChapterDocument } from "../domain/chapter.js";
import { countChineseWords } from "../pipelines/chapter/rules.js";
import type { WorkMeta } from "../storage/work.js";
import {
  decodeTextBuffer,
  decodeTextBufferWithEncoding,
  extractFilenameOrder,
  extractMarkdownTitleAndBody,
  formatChapterId,
  parseChineseNumber,
  splitLegacyChapters,
  splitLegacyChaptersDetailed,
  type LegacyChapterChunk,
  type LegacyEncoding,
} from "./import-parse.js";

export {
  decodeTextBuffer,
  decodeTextBufferWithEncoding,
  parseChineseNumber,
  splitLegacyChapters,
  splitLegacyChaptersDetailed,
  type LegacyChapterChunk,
  type LegacyEncoding,
};

export interface ImportLegacyWorkInput {
  worksRoot: string;
  workId: string;
  title: string;
  sourcePath: string;
  sourceKind: "single_txt" | "folder";
  allowedRoot?: string;
  grade?: WorkMeta["grade"];
  profile?: string;
  chapterStatus?: "final" | "drafted";
}

export interface PreviewLegacyWorkInput {
  sourcePath: string;
  sourceKind: "single_txt" | "folder";
  allowedRoot?: string;
}

export interface PreviewLegacyChapterItem {
  chapterId: string;
  originalNumber: number | null;
  volume?: string;
  title: string;
  wordCount: number;
  kind: "prelude" | "chapter";
}

export interface PreviewLegacyWorkResult {
  encoding: LegacyEncoding;
  totalFiles: number;
  chapterCount: number;
  totalWords: number;
  hasPrelude: boolean;
  preludeChars: number;
  emptyHeadings: string[];
  chapters: PreviewLegacyChapterItem[];
}

export interface ImportLegacyWorkResult {
  workId: string;
  workPath: string;
  title: string;
  chapterCount: number;
  totalWords: number;
  backupDir: string;
  chapterIds: string[];
}

async function makeIntentWrite(filePath: string, after: string): Promise<IntentWrite> {
  const prev = await readTextIfExists(filePath);
  return {
    path: filePath,
    beforeHash: prev === undefined ? null : sha256(prev),
    after,
  };
}

async function loadLegacySource(input: PreviewLegacyWorkInput): Promise<{
  resolvedSource: string;
  encoding: LegacyEncoding;
  totalFiles: number;
  hasPrelude: boolean;
  preludeChars: number;
  emptyHeadings: string[];
  chapters: LegacyChapterChunk[];
  rawBackups: Array<{ filename: string; rawBytes: Uint8Array }>;
}> {
  const resolvedSource = input.allowedRoot
    ? await resolveInsideAsync(
        input.allowedRoot,
        path.isAbsolute(input.sourcePath)
          ? path.relative(input.allowedRoot, input.sourcePath)
          : input.sourcePath,
      )
    : path.resolve(input.sourcePath);

  const rawBackups: Array<{ filename: string; rawBytes: Uint8Array }> = [];
  let chapters: LegacyChapterChunk[] = [];
  let encoding: LegacyEncoding = "utf-8";
  let hasPrelude = false;
  let preludeChars = 0;
  let emptyHeadings: string[] = [];

  if (input.sourceKind === "single_txt") {
    const rawBuf = await fs.readFile(resolvedSource).catch(() => {
      throw new AppError("input.not_found", `未找到待导入文件：${resolvedSource}`, {
        sourcePath: resolvedSource,
      });
    });
    const decoded = decodeTextBufferWithEncoding(rawBuf);
    encoding = decoded.encoding;
    rawBackups.push({ filename: path.basename(resolvedSource), rawBytes: rawBuf });
    const report = splitLegacyChaptersDetailed(decoded.text);
    chapters = report.chunks.map((c) => ({ ...c, sourceFilename: path.basename(resolvedSource) }));
    hasPrelude = report.hasPrelude;
    preludeChars = report.preludeChars;
    emptyHeadings = report.emptyHeadings;
  } else {
    const entries = await fs.readdir(resolvedSource, { withFileTypes: true }).catch(() => {
      throw new AppError("input.not_found", `未找到待导入目录：${resolvedSource}`, {
        sourcePath: resolvedSource,
      });
    });
    const textFiles = entries
      .filter((entry) => entry.isFile() && /\.(?:md|txt)$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => {
        const orderDiff = extractFilenameOrder(a) - extractFilenameOrder(b);
        return orderDiff !== 0 ? orderDiff : a.localeCompare(b, "zh-CN", { numeric: true });
      });

    for (const fileName of textFiles) {
      const fullPath = await resolveInsideAsync(resolvedSource, fileName);
      const rawBuf = await fs.readFile(fullPath);
      const decoded = decodeTextBufferWithEncoding(rawBuf);
      if (rawBackups.length === 0 || decoded.encoding === "gb18030") {
        encoding = decoded.encoding;
      }
      rawBackups.push({ filename: fileName, rawBytes: rawBuf });
      const stem = fileName.replace(/\.(?:md|txt)$/i, "");
      const { title: chTitle, body } = extractMarkdownTitleAndBody(decoded.text, stem);
      if (body.length > 0) {
        chapters.push({
          number: extractFilenameOrder(fileName),
          title: chTitle,
          body,
          kind: "chapter",
          sourceFilename: fileName,
        });
      } else {
        emptyHeadings.push(fileName);
      }
    }
  }

  return {
    resolvedSource,
    encoding,
    totalFiles: rawBackups.length,
    hasPrelude,
    preludeChars,
    emptyHeadings,
    chapters,
    rawBackups,
  };
}

export async function previewLegacyWork(
  input: PreviewLegacyWorkInput,
): Promise<PreviewLegacyWorkResult> {
  const loaded = await loadLegacySource(input);
  let totalWords = 0;
  const chapters: PreviewLegacyChapterItem[] = loaded.chapters.map((chunk, i) => {
    const wordCount = countChineseWords(chunk.body);
    totalWords += wordCount;
    return {
      chapterId: formatChapterId(i + 1),
      originalNumber: chunk.number,
      ...(chunk.volume ? { volume: chunk.volume } : {}),
      title: chunk.title,
      wordCount,
      kind: chunk.kind ?? "chapter",
    };
  });
  return {
    encoding: loaded.encoding,
    totalFiles: loaded.totalFiles,
    chapterCount: chapters.length,
    totalWords,
    hasPrelude: loaded.hasPrelude,
    preludeChars: loaded.preludeChars,
    emptyHeadings: loaded.emptyHeadings,
    chapters,
  };
}

export async function importLegacyWork(
  input: ImportLegacyWorkInput,
  lock: LockService = createLockService(systemClock),
  clock: Clock = systemClock,
): Promise<ImportLegacyWorkResult> {
  const workId = input.workId.trim();
  const title = input.title.trim();
  if (!workId || !title) {
    throw new AppError("input.invalid", "作品 ID 与书名不能为空", { field: "title" });
  }

  const workPath = await resolveInsideAsync(input.worksRoot, workId);
  const exists = await fs.stat(workPath).then(
    () => true,
    () => false,
  );
  if (exists) {
    throw new AppError("input.invalid", `作品已存在：${title}`, { field: "workId" });
  }

  const loaded = await loadLegacySource(input);
  if (loaded.chapters.length === 0) {
    throw new AppError("input.invalid", "未在导入源中识别到有效章节正文", {
      sourcePath: loaded.resolvedSource,
    });
  }

  const nowIso = clock.iso();
  const chapterStatus = input.chapterStatus ?? "final";
  const backupDir = path.join(workPath, "sources", "legacy-import");
  const chapterIds: string[] = [];
  let totalWords = 0;

  const meta: WorkMeta = {
    format: FORMAT_VERSION,
    id: workId,
    title,
    created: nowIso,
    profile: input.profile ?? "default",
    grade: input.grade ?? "standard",
    tags: undefined,
    pinned: undefined,
    archived: undefined,
    targetTotalWords: undefined,
    publishedThrough: undefined,
    dailyTargetChars: undefined,
    synopsis: undefined,
    updatedAt: nowIso,
    settings: {
      requireEditorPass: false,
      targetWords: 3000,
      previousTextMode: "auto",
    },
  };

  await lock.write({ kind: "work", path: workPath }, async () => {
    await Promise.all([
      fs.mkdir(path.join(workPath, "plan"), { recursive: true }),
      fs.mkdir(path.join(workPath, "chapters"), { recursive: true }),
      fs.mkdir(path.join(workPath, "candidates"), { recursive: true }),
      fs.mkdir(path.join(workPath, "history"), { recursive: true }),
      fs.mkdir(path.join(workPath, "bible"), { recursive: true }),
      fs.mkdir(path.join(workPath, ".cache"), { recursive: true }),
      fs.mkdir(backupDir, { recursive: true }),
    ]);

    for (const entry of loaded.rawBackups) {
      const backupFile = await resolveInsideAsync(backupDir, path.basename(entry.filename));
      await atomicWrite(backupFile, entry.rawBytes);
    }

    const writes: IntentWrite[] = [
      await makeIntentWrite(path.join(workPath, "work.json"), JSON.stringify(meta, null, 2)),
      await makeIntentWrite(
        path.join(workPath, "plan", "structure.json"),
        JSON.stringify([], null, 2),
      ),
    ];

    const emptyStyle = { contract: "", rules: [], voiceSamples: [] };
    const bibleEmptyFiles: Array<[string, string]> = [
      ["entities.json", "[]"],
      ["states.json", "[]"],
      ["threads.json", "[]"],
      ["knowledge.json", "[]"],
      ["chapters.json", "[]"],
      ["style.json", JSON.stringify(emptyStyle, null, 2)],
      ["pending.json", "[]"],
    ];
    for (const [name, content] of bibleEmptyFiles) {
      writes.push(await makeIntentWrite(path.join(workPath, "bible", name), content));
    }
    const indexJson = JSON.stringify(
      {
        format: FORMAT_VERSION,
        hashes: {
          entities: sha256("[]"),
          states: sha256("[]"),
          threads: sha256("[]"),
          knowledge: sha256("[]"),
          chapters: sha256("[]"),
          style: sha256(JSON.stringify(emptyStyle)),
          pending: sha256("[]"),
        },
      },
      null,
      2,
    );
    writes.push(await makeIntentWrite(path.join(workPath, "bible", "index.json"), indexJson));

    const manifestChapters: Array<Record<string, unknown>> = [];
    for (let i = 0; i < loaded.chapters.length; i++) {
      const chunk = loaded.chapters[i];
      const chapterId = formatChapterId(i + 1);
      const wordCount = countChineseWords(chunk.body);
      chapterIds.push(chapterId);
      totalWords += wordCount;
      manifestChapters.push({
        chapterId,
        originalNumber: chunk.number,
        ...(chunk.volume ? { volume: chunk.volume } : {}),
        title: chunk.title,
        wordCount,
        kind: chunk.kind ?? "chapter",
        ...(chunk.sourceFilename ? { sourceFilename: chunk.sourceFilename } : {}),
      });
      const doc: ChapterDocument = {
        meta: {
          id: chapterId,
          title: chunk.title,
          status: chapterStatus,
          revision: `rev-${sha256(chunk.body).slice(0, 8)}`,
          ...(chapterStatus === "final" ? { finalizedAt: nowIso } : {}),
        },
        body: chunk.body,
      };
      writes.push(
        await makeIntentWrite(
          path.join(workPath, "chapters", `${chapterId}.md`),
          serializeChapterMarkdown(doc),
        ),
      );
    }

    const manifest = {
      format: FORMAT_VERSION,
      importedAt: nowIso,
      sourceKind: input.sourceKind,
      encoding: loaded.encoding,
      chapterStatus,
      hasPrelude: loaded.hasPrelude,
      preludeChars: loaded.preludeChars,
      emptyHeadings: loaded.emptyHeadings,
      chapters: manifestChapters,
    };
    writes.push(
      await makeIntentWrite(
        path.join(backupDir, "import-manifest.json"),
        JSON.stringify(manifest, null, 2),
      ),
    );

    await commitIntent(
      path.join(workPath, ".journal"),
      {
        format: FORMAT_VERSION,
        id: `legacy-import-${clock.now()}`,
        writes,
        meta: {
          operation: "fanqie.work.importLegacy",
          sourceKind: input.sourceKind,
          chapterCount: String(loaded.chapters.length),
        },
      },
      lock,
      { kind: "work", path: workPath },
    );
  });

  return {
    workId,
    workPath,
    title,
    chapterCount: loaded.chapters.length,
    totalWords,
    backupDir,
    chapterIds,
  };
}
