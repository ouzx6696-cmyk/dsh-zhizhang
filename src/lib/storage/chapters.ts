/** Chapter encoding, reads and serialized updates; the store facade re-exports the public API. */
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { CHAPTER_STATUSES, EMPTY_OUTLINE } from "../types.js";
import type { Outline } from "../types.js";
import { assertResourceId, countWords, isMissingFileError, nowIso } from "./primitives.js";
import { assertNoPendingAccept, snapshotFile } from "./accept-journal.js";
import { createChapterJournal, finishChapterJournal } from "./chapter-journal.js";
import { withResourceLock } from "./process-lock.js";
import { readWorkMeta, validateStoryPace } from "./work-meta.js";
export function chaptersDir(dir: string) {
    return path.join(dir, "chapters");
}
function normalizeOutline(raw: any): Outline {
    const base = EMPTY_OUTLINE();
    if (!raw || typeof raw !== "object")
        return base;
    return {
        pov: String(raw.pov ?? ""),
        targetWords: typeof raw.targetWords === "number" && raw.targetWords > 0 ? raw.targetWords : 2500,
        locks: String(raw.locks ?? ""),
        knowledge: String(raw.knowledge ?? ""),
        synopsis: String(raw.synopsis ?? ""),
        conflict: String(raw.conflict ?? ""),
        beats: String(raw.beats ?? ""),
        ending: String(raw.ending ?? ""),
        situationLens: String(raw.situationLens ?? ""),
        livedScene: String(raw.livedScene ?? ""),
        // 0.6: stateLens; legacy voiceTone still readable
        stateLens: String(raw.stateLens ??
            raw.voiceTone ??
            ""),
    };
}
function chapterFile(dir: string, id: string) {
    return path.join(chaptersDir(dir), `${assertResourceId(id, "章节 id")}.md`);
}
function serializeChapterMarkdown(record: any) {
    const fm = {
        id: record.id,
        title: record.title,
        position: record.position,
        status: record.status,
        wordCount: record.wordCount,
        updatedAt: record.updatedAt,
        outline: record.outline,
    };
    return `---\n${JSON.stringify(fm, null, 2)}\n---\n\n${record.body ?? ""}\n`;
}
function parseChapterMarkdown(raw: string, fallbackId: any) {
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
    if (!match) {
        return {
            id: fallbackId,
            title: fallbackId,
            position: 0,
            status: "drafting",
            wordCount: countWords(raw),
            updatedAt: nowIso(),
            body: raw,
            outline: EMPTY_OUTLINE(),
        };
    }
    let meta;
    try {
        meta = JSON.parse(match[1]);
    }
    catch {
        throw new Error(`章节 front matter 不是合法 JSON：${fallbackId}`);
    }
    // serializeChapterMarkdown always appends a trailing newline; strip it on read.
    const body = (match[2] ?? "").replace(/^\n/, "").replace(/\n$/, "");
    const status = CHAPTER_STATUSES.includes(meta.status)
        ? meta.status
        : "drafting";
    return {
        id: String(meta.id ?? fallbackId),
        title: String(meta.title ?? fallbackId),
        position: typeof meta.position === "number" ? meta.position : 0,
        status,
        wordCount: countWords(body),
        updatedAt: String(meta.updatedAt ?? nowIso()),
        body,
        outline: normalizeOutline(meta.outline),
    };
}
// —— § chapters ——
export async function listChapters(dir: string) {
    const meta = await readWorkMeta(dir);
    return [...meta.chapters].sort((a: any, b: any) => a.position - b.position);
}
export async function readChapter(dir: string, chapterId: string) {
    await assertNoPendingAccept(dir);
    const file = chapterFile(dir, chapterId);
    const raw = await readFile(file, "utf8");
    return parseChapterMarkdown(raw, chapterId);
}
/**
 * Panel-only lens read with an mtime+size cache. The Web workbench polls every
 * ~6s; without this it re-reads every chapter file per poll.
 */
const CHAPTER_LENS_CACHE_MAX = 400;
const chapterLensCache = new Map();
export async function readChapterLens(dir: string, chapterId: string) {
    await assertNoPendingAccept(dir);
    const file = chapterFile(dir, chapterId);
    const st = await stat(file);
    const hit = chapterLensCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.ctimeMs === st.ctimeMs && hit.ino === st.ino && hit.size === st.size)
        return hit.lens;
    const record = parseChapterMarkdown(await readFile(file, "utf8"), chapterId);
    const lens = {
        situationLens: record.outline.situationLens,
        livedScene: record.outline.livedScene,
        stateLens: record.outline.stateLens,
    };
    chapterLensCache.set(file, { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, size: st.size, lens });
    if (chapterLensCache.size > CHAPTER_LENS_CACHE_MAX) {
        const oldest = chapterLensCache.keys().next().value;
        if (oldest !== undefined)
            chapterLensCache.delete(oldest);
    }
    return lens;
}
export async function saveChapter(dir: string, input: any) {
    return withResourceLock(dir, () => saveChapterUnlocked(dir, input));
}

/** Caller must hold the work lock. */
export async function prepareChapterSaveUnlocked(dir: string, input: any) {
    const meta = await readWorkMeta(dir);
    const pace = validateStoryPace(input.workPace);
    if (pace !== undefined) meta.pace = pace;
    const id = input.id?.trim() || `c${String(meta.chapters.length + 1).padStart(3, "0")}`;
    const existingIdx = meta.chapters.findIndex((c: any) => c.id === id);
    let previous = null;
    if (existingIdx >= 0) {
        try {
            previous = await readChapter(dir, id);
        }
        catch (err) {
            // 登记过但读不出来：只有「文件缺失」可以当新建恢复，
            // front matter 损坏必须报出来，不能让 outline/status 被静默重置。
            if (!isMissingFileError(err))
                throw err;
            previous = null;
        }
    }
    const position = typeof input.position === "number"
        ? input.position
        : previous?.position ?? (existingIdx >= 0 ? meta.chapters[existingIdx].position : meta.chapters.length + 1);
    const outline = normalizeOutline({ ...(previous?.outline ?? EMPTY_OUTLINE()), ...(input.outline ?? {}) });
    const status = input.status && CHAPTER_STATUSES.includes(input.status)
        ? input.status
        : previous?.status ?? "drafted";
    const record = {
        id,
        title: input.title.trim() || previous?.title || id,
        position,
        status,
        wordCount: countWords(input.body),
        updatedAt: nowIso(),
        body: input.body,
        outline,
    };
    const summary = {
        id: record.id,
        title: record.title,
        position: record.position,
        status: record.status,
        wordCount: record.wordCount,
        updatedAt: record.updatedAt,
    };
    if (existingIdx >= 0)
        meta.chapters[existingIdx] = summary;
    else
        meta.chapters.push(summary);
    meta.chapters.sort((a: any, b: any) => a.position - b.position);
    meta.updatedAt = nowIso();
    return { record, chapterPath: chapterFile(dir, id), chapterContent: serializeChapterMarkdown(record), metaContent: JSON.stringify(meta, null, 2) + "\n" };
}
/** Caller holds the work lock. */
export async function saveChapterUnlocked(dir: string, input: any) {
    const prepared = await prepareChapterSaveUnlocked(dir, input);
    await mkdir(chaptersDir(dir), { recursive: true });
    const metaPath = path.join(dir, "meta.json");
    const [chapterBefore, metaBefore] = await Promise.all([snapshotFile(prepared.chapterPath), snapshotFile(metaPath)]);
    try {
        const journal = await createChapterJournal(dir, { chapterId: prepared.record.id, writes: [
            { file: `chapters/${prepared.record.id}.md`, before: chapterBefore, content: prepared.chapterContent },
            { file: "meta.json", before: metaBefore, content: prepared.metaContent },
        ] });
        await finishChapterJournal(dir, journal);
    }
    catch (err: any) {
        if (err instanceof ZhizhangError) throw err;
        throw new ZhizhangError("recovery_required", `章节 ${prepared.record.id} 保存未完成（${err?.message ?? String(err)}）。请用 zhizhang_status(work=作品, recovery=inspect) 检查，不要重复保存。`);
    }
    return prepared.record;
}
export async function setOutline(dir: string, chapterId: string, patch: any, title?: string, options: { pace?: string } = {}) {
    return withResourceLock(dir, async () => {
        let previous = null;
        try {
            previous = await readChapter(dir, chapterId);
        }
        catch (err) {
            // 章节文件损坏（front matter 非法等）不能当成「不存在」继续写：
            // 后续 saveChapter 会用空正文覆盖原文件，直接丢稿。
            if (!isMissingFileError(err))
                throw err;
        }
        return saveChapterUnlocked(dir, {
            id: chapterId,
            title: title ?? previous?.title ?? chapterId,
            body: previous?.body ?? "",
            position: previous?.position,
            status: previous?.status ?? "planned",
            outline: { ...(previous?.outline ?? EMPTY_OUTLINE()), ...patch },
            workPace: options.pace,
        });
    });
}

/** Apply a direct chapter edit using the current content inside the work lock. */
export async function updateChapter(dir: string, input: { id: string; title?: string; body?: string; status?: string; position?: number }) {
    return withResourceLock(dir, async () => {
        let previous;
        try {
            previous = await readChapter(dir, input.id);
        }
        catch (err) {
            if (!isMissingFileError(err)) throw err;
        }
        if (!previous && input.body === undefined)
            throw new ZhizhangError("bad_args", "新建章节必须提供 content");
        return saveChapterUnlocked(dir, {
            id: input.id,
            title: input.title ?? previous?.title ?? input.id,
            body: input.body ?? previous?.body ?? "",
            status: input.status,
            position: input.position,
        });
    });
}
