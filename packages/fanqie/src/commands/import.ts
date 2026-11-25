import fs from "node:fs/promises";
import path from "node:path";
import { systemClock, type Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, resolveInsideAsync, sha256 } from "@zhizhang/core/fs";
import { commitIntent, type IntentWrite } from "@zhizhang/core/journal";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { serializeChapterMarkdown, type ChapterDocument } from "../domain/chapter.js";
import { countChineseWords } from "../pipelines/chapter/rules.js";
import type { WorkMeta } from "../storage/work.js";

export interface LegacyChapterChunk {
  number: number | null;
  title: string;
  body: string;
}

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

export interface ImportLegacyWorkResult {
  workId: string;
  workPath: string;
  title: string;
  chapterCount: number;
  totalWords: number;
  backupDir: string;
  chapterIds: string[];
}

const CN_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const CN_UNITS: Record<string, number> = {
  十: 10,
  百: 100,
  千: 1000,
  万: 10000,
};

const CHAPTER_HEADING_RE =
  /^\s*(?:第([零〇一二三四五六七八九十百千万两\d]+)[章节回卷部]\s*(.*)|(?:Chapter|CHAPTER)\s+(\d+)\s*[:：.\-]?\s*(.*))$/;

export function decodeTextBuffer(buf: Uint8Array): string {
  try {
    const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    return utf8.replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("gb18030").decode(buf).replace(/^\uFEFF/, "");
  }
}

export function parseChineseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10);

  let total = 0;
  let section = 0;
  let current = 0;
  let sawValid = false;

  for (const ch of trimmed) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch];
      sawValid = true;
    } else if (ch in CN_UNITS) {
      const unit = CN_UNITS[ch];
      sawValid = true;
      if (unit === 10000) {
        section = (section + current) * unit;
        total += section;
        section = 0;
        current = 0;
      } else {
        const factor = current === 0 && unit === 10 && section === 0 ? 1 : current;
        section += factor * unit;
        current = 0;
      }
    } else {
      return null;
    }
  }
  return sawValid ? total + section + current : null;
}

export function splitLegacyChapters(rawText: string): LegacyChapterChunk[] {
  const normalized = rawText.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const chunks: Array<{ number: number | null; title: string; lines: string[] }> = [];
  let current: { number: number | null; title: string; lines: string[] } | null = null;
  const preludeLines: string[] = [];

  for (const line of lines) {
    const match = CHAPTER_HEADING_RE.exec(line);
    if (match) {
      if (current) chunks.push(current);
      const rawNum = match[1] ?? match[3] ?? "";
      const parsedNum = parseChineseNumber(rawNum);
      const heading = line.trim();
      current = { number: parsedNum, title: heading, lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else {
      preludeLines.push(line);
    }
  }
  if (current) chunks.push(current);

  const cleaned = chunks
    .map((chunk) => ({
      number: chunk.number,
      title: chunk.title,
      body: chunk.lines.join("\n").trim(),
    }))
    .filter((chunk) => chunk.body.length > 0);

  if (cleaned.length === 0) {
    const whole = normalized.trim();
    if (!whole) return [];
    return [{ number: 1, title: "第1章", body: whole }];
  }

  const prelude = preludeLines.join("\n").trim();
  if (prelude.length >= 200) {
    return [{ number: 0, title: "楔子", body: prelude }, ...cleaned];
  }
  return cleaned;
}

function formatChapterId(index: number): string {
  return `C${String(index).padStart(3, "0")}`;
}

function extractFilenameOrder(filename: string): number {
  const stem = filename.replace(/\.[^.]+$/, "");
  const cnMatch = /第([零〇一二三四五六七八九十百千万两\d]+)[章节回]/.exec(stem);
  if (cnMatch) {
    const parsed = parseChineseNumber(cnMatch[1]);
    if (parsed !== null) return parsed;
  }
  const numMatch = /(\d+)/.exec(stem);
  return numMatch ? Number.parseInt(numMatch[1], 10) : Number.MAX_SAFE_INTEGER;
}

function extractMarkdownTitleAndBody(
  raw: string,
  fallbackTitle: string,
): { title: string; body: string } {
  const normalized = raw.replace(/\r\n?/g, "\n").trim();
  const firstBreak = normalized.indexOf("\n");
  const firstLine = (firstBreak === -1 ? normalized : normalized.slice(0, firstBreak)).trim();
  if (firstLine.startsWith("# ")) {
    const title = firstLine.slice(2).trim() || fallbackTitle;
    const body = firstBreak === -1 ? "" : normalized.slice(firstBreak + 1).trim();
    return { title, body };
  }
  return { title: fallbackTitle, body: normalized };
}

async function makeIntentWrite(filePath: string, after: string): Promise<IntentWrite> {
  const prev = await readTextIfExists(filePath);
  return {
    path: filePath,
    beforeHash: prev === undefined ? null : sha256(prev),
    after,
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

  const resolvedSource = input.allowedRoot
    ? await resolveInsideAsync(
        input.allowedRoot,
        path.isAbsolute(input.sourcePath)
          ? path.relative(input.allowedRoot, input.sourcePath)
          : input.sourcePath,
      )
    : path.resolve(input.sourcePath);
  const workPath = await resolveInsideAsync(input.worksRoot, workId);

  const exists = await fs.stat(workPath).then(
    () => true,
    () => false,
  );
  if (exists) {
    throw new AppError("input.invalid", `作品已存在：${title}`, { field: "workId" });
  }

  const backupEntries: Array<{ filename: string; content: string }> = [];
  let chapters: LegacyChapterChunk[] = [];

  if (input.sourceKind === "single_txt") {
    const rawBuf = await fs.readFile(resolvedSource).catch(() => {
      throw new AppError("input.not_found", `未找到待导入文件：${resolvedSource}`, {
        sourcePath: resolvedSource,
      });
    });
    const decoded = decodeTextBuffer(rawBuf);
    backupEntries.push({ filename: path.basename(resolvedSource), content: decoded });
    chapters = splitLegacyChapters(decoded);
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
      const decoded = decodeTextBuffer(await fs.readFile(fullPath));
      backupEntries.push({ filename: fileName, content: decoded });
      const stem = fileName.replace(/\.(?:md|txt)$/i, "");
      const { title: chTitle, body } = extractMarkdownTitleAndBody(decoded, stem);
      if (body.length > 0) {
        chapters.push({ number: extractFilenameOrder(fileName), title: chTitle, body });
      }
    }
  }

  if (chapters.length === 0) {
    throw new AppError("input.invalid", "未在导入源中识别到有效章节正文", {
      sourcePath: resolvedSource,
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

    const writes: IntentWrite[] = [];
    writes.push(
      await makeIntentWrite(path.join(workPath, "work.json"), JSON.stringify(meta, null, 2)),
      await makeIntentWrite(
        path.join(workPath, "plan", "structure.json"),
        JSON.stringify([], null, 2),
      ),
    );

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

    for (let i = 0; i < chapters.length; i++) {
      const chunk = chapters[i];
      const chapterId = formatChapterId(i + 1);
      chapterIds.push(chapterId);
      totalWords += countChineseWords(chunk.body);
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

    for (const entry of backupEntries) {
      const backupFile = await resolveInsideAsync(backupDir, path.basename(entry.filename));
      writes.push(await makeIntentWrite(backupFile, entry.content));
    }

    await commitIntent(
      path.join(workPath, ".journal"),
      {
        format: FORMAT_VERSION,
        id: `legacy-import-${clock.now()}`,
        writes,
        meta: {
          operation: "fanqie.work.importLegacy",
          sourceKind: input.sourceKind,
          chapterCount: String(chapters.length),
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
    chapterCount: chapters.length,
    totalWords,
    backupDir,
    chapterIds,
  };
}
