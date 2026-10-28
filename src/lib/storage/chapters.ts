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
import { contextBasis, fingerprint } from "../domain/lifecycle.js";
import type { ContextBasis, ChapterDependency, ChapterReview } from "../domain/lifecycle.js";
import { readLedger, LEDGER_MAX_ENTRIES } from "./ledger.js";
import { chapterRevision, preserveChapter } from "./revision.js";
import { metaPath, readWorkMeta, validateStoryPace } from "./work-meta.js";
export function chaptersDir(dir: string) {
    return path.join(dir, "chapters");
}
function normalizeOutline(raw: any): Outline {
    const base = EMPTY_OUTLINE();
    if (!raw || typeof raw !== "object")
        return base;
    return {
        ...raw,
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
    const { body, revision, ...fm } = record;
    return `---\n${JSON.stringify(fm, null, 2)}\n---\n\n${record.body ?? ""}\n`;
}
function parseChapterMarkdown(raw: string, fallbackId: any) {
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/);
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
            review: undefined as ChapterReview | undefined,
            dependencies: [] as ChapterDependency[],
        };
    }
    let meta;
    try {
        meta = JSON.parse(match[1]);
    }
    catch {
        throw new Error(`章节 front matter 不是合法 JSON：${fallbackId}`);
    }
    if (!meta || typeof meta !== "object" || Array.isArray(meta) || (meta.id !== undefined && meta.id !== fallbackId) || (meta.status !== undefined && !CHAPTER_STATUSES.includes(meta.status)) || (meta.outline != null && (typeof meta.outline !== "object" || Array.isArray(meta.outline))))
        throw new ZhizhangError("bad_chapter", `章节元数据格式损坏：${fallbackId}`);
    if (meta.review && (!/^[a-f0-9]{64}$/.test(meta.review.revision) || !["pass", "blocked"].includes(meta.review.result) || typeof meta.review.summary !== "string" || !meta.review.basis || typeof meta.review.basis.foundation !== "string" || typeof meta.review.basis.planning !== "string"))
        throw new ZhizhangError("bad_chapter", `章节审读记录损坏：${fallbackId}`);
    // serializeChapterMarkdown always appends a trailing newline; strip it on read.
    const body = (match[2] ?? "").replace(/^\r?\n/, "").replace(/\r?\n$/, "");
    const status = CHAPTER_STATUSES.includes(meta.status)
        ? meta.status
        : "drafting";
    return {
        ...meta,
        id: String(meta.id ?? fallbackId),
        title: String(meta.title ?? fallbackId),
        position: typeof meta.position === "number" ? meta.position : 0,
        status,
        wordCount: countWords(body),
        updatedAt: String(meta.updatedAt ?? nowIso()),
        body,
        outline: normalizeOutline(meta.outline),
        review: meta.review as ChapterReview | undefined,
        dependencies: (Array.isArray(meta.dependencies) ? meta.dependencies : []) as ChapterDependency[],
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
    const chapter = parseChapterMarkdown(raw, chapterId);
    return { ...chapter, revision: chapterRevision(chapter) };
}
/**
 * Panel-only lens read with an mtime+size cache. The Web workbench polls every
 * ~6s; without this it re-reads every chapter file per poll.
 */
const CHAPTER_LENS_CACHE_BYTES = 8 * 1024 * 1024;
let chapterLensBytes = 0;
const chapterLensCache = new Map();
async function readChapterLens(dir: string, chapterId: string) {
    const file = chapterFile(dir, chapterId);
    const st = await stat(file);
    const hit = chapterLensCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.ctimeMs === st.ctimeMs && hit.ino === st.ino && hit.size === st.size)
        return hit.lens;
    const record = parseChapterMarkdown(await readFile(file, "utf8"), chapterId);
    const lens = {
        revision: chapterRevision(record),
        readVersion: fingerprint(record),
        updatedAt: record.updatedAt,
        status: record.status,
        title: record.title,
        wordCount: record.wordCount,
        situationLens: record.outline.situationLens,
        livedScene: record.outline.livedScene,
        stateLens: record.outline.stateLens,
    };
    if (hit) chapterLensBytes -= hit.bytes;
    chapterLensCache.delete(file);
    const bytes = 512 + 2 * (file.length + lens.title.length + lens.situationLens.length + lens.livedScene.length + lens.stateLens.length);
    if (bytes <= CHAPTER_LENS_CACHE_BYTES) {
        chapterLensCache.set(file, { mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino, size: st.size, lens, bytes });
        chapterLensBytes += bytes;
    }
    while (chapterLensBytes > CHAPTER_LENS_CACHE_BYTES) {
        const oldest = chapterLensCache.keys().next().value;
        if (oldest === undefined) break;
        chapterLensBytes -= chapterLensCache.get(oldest).bytes;
        chapterLensCache.delete(oldest);
    }
    return lens;
}
/** One recovery check per query, with bounded filesystem concurrency. */
export async function readChapterLenses(dir: string, ids: string[]) {
    await assertNoPendingAccept(dir);
    const rows: { id: string; lens?: Awaited<ReturnType<typeof readChapterLens>>; error?: string }[] = [];
    for (let offset = 0; offset < ids.length; offset += 16) {
        rows.push(...await Promise.all(ids.slice(offset, offset + 16).map(async id => {
            try { return { id, lens: await readChapterLens(dir, id) }; }
            catch (error) { return { id, error: error instanceof Error ? error.message : String(error) }; }
        })));
    }
    return rows;
}
function precedingChapter(meta: any, chapterId: string) {
    const ordered = [...meta.chapters].sort((a: any, b: any) => a.position - b.position);
    const index = ordered.findIndex((c: any) => c.id === chapterId);
    return index > 0 ? ordered[index - 1] : undefined;
}
export async function assertContextBasis(dir: string, basis: ContextBasis, chapterId: string) {
    const meta = await readWorkMeta(dir);
    if ((await readChapter(dir, chapterId)).revision !== basis.targetRevision)
        throw new ZhizhangError("context_changed", "本章正文或章纲在准备简报后变化，请重新核对依据。");
    if (basis.foundation !== fingerprint(meta.foundation) || basis.planning !== fingerprint(meta.planning))
        throw new ZhizhangError("context_changed", "根基或规划已变化，请核对后重新取得简报与准备候选。");
    const previous = precedingChapter(meta, chapterId);
    if (previous?.id !== basis.previous?.chapterId ||
        (basis.previous && (await readChapter(dir, basis.previous.chapterId)).revision !== basis.previous.revision))
        throw new ZhizhangError("dependency_changed", "所依赖前稿或章节顺序已变化，请重核后稿，不会自动改写正文。");
}
export async function currentContextBasis(dir: string, chapterId: string): Promise<ContextBasis> {
    const meta = await readWorkMeta(dir), chapter = await readChapter(dir, chapterId);
    const predecessor = precedingChapter(meta, chapterId);
    let previous: ChapterDependency | undefined;
    if (predecessor) {
        const prev = await readChapter(dir, predecessor.id);
        previous = { chapterId: prev.id, revision: prev.revision, kind: prev.status === "final" ? "final" : "working" };
    }
    return contextBasis(meta, chapter, previous);
}
export async function saveChapter(dir: string, input: any) {
    return withResourceLock(dir, () => saveChapterUnlocked(dir, input));
}

/** Caller must hold the work lock. */
export async function prepareChapterSaveUnlocked(dir: string, input: any) {
    const metaBefore = await snapshotFile(metaPath(dir));
    const meta = await readWorkMeta(dir);
    const pace = validateStoryPace(input.workPace);
    if (pace !== undefined) meta.pace = pace;
    const id = input.id?.trim() || `c${String(meta.chapters.length + 1).padStart(3, "0")}`;
    const chapterBefore = await snapshotFile(chapterFile(dir, id));
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
    const changed = previous != null && previous.body !== input.body;
    if (input.expectedRevision !== undefined && previous?.revision !== input.expectedRevision)
        throw new ZhizhangError("revision_conflict", "目标章已变化，请读取现行正文后重新准备候选。");
    if (changed && previous?.status === "final" && input.force !== true)
        throw new ZhizhangError("refuse_overwrite_final", "定稿正文修改须明确 force=true；修订后降回 drafted 并需重新审读定稿。");
    let status = changed && (previous?.status === "final" || previous?.status === "reviewed") ? "drafted" : input.status && CHAPTER_STATUSES.includes(input.status)
        ? input.status
        : previous?.status ?? "drafted";
    const record = {
        ...previous,
        id,
        title: input.title.trim() || previous?.title || id,
        position,
        status,
        wordCount: countWords(input.body),
        updatedAt: nowIso(),
        body: input.body,
        outline,
        review: previous?.review,
        dependencies: input.dependencies ?? previous?.dependencies ?? [],
    };
    const revision = chapterRevision(record);
    record.revision = revision;
    if (input.reviewDeclaration === true) {
        if (input.reviewResult !== undefined && !["pass", "blocked"].includes(input.reviewResult)) throw new ZhizhangError("bad_args", "review_result 只接受 pass 或 blocked。");
        if (changed) throw new ZhizhangError("review_changed", "正文修改后须另行审读，不能沿用旧审读。");
        if (input.expectedRevision === undefined) throw new ZhizhangError("review_revision_required", "声明审读须提供 expected_revision，绑定实际读过的版本。");
        const context = previous ? await currentContextBasis(dir, id) : contextBasis(meta, { revision });
        record.dependencies = context.previous ? [context.previous] : [];
        record.review = { revision, basis: context, result: input.reviewResult === "blocked" ? "blocked" : "pass", summary: input.reviewSummary ?? "声明已完整回读当前版本", declaredBy: input.reviewedBy ?? "tool caller", at: nowIso() };
    }
    if (status === "reviewed" && record.review?.revision !== revision) { status = "drafted"; record.status = status; }
    if (status === "final" && previous?.status !== "final") {
        if (!record.body.trim() || !record.review || record.review.result !== "pass" || record.review.revision !== revision)
            throw new ZhizhangError("review_required", "定稿须先声明当前版本已完整审读通过：chapter_save(status=reviewed, expected_revision=读章所得revision)。");
        await assertContextBasis(dir, record.review.basis, id);
        if (record.review.basis.previous && (await readChapter(dir, record.review.basis.previous.chapterId)).status !== "final")
            throw new ZhizhangError("dependency_not_final", "定稿前请先核定所依赖前章；条件草稿可继续连写，但不进入定稿事实。");
    }
    if (input.acknowledgeRevision === true) {
        if (!input.expectedRevision || input.expectedRevision !== revision) throw new ZhizhangError("revision_conflict", "核对修订须提供当前 expected_revision。");
        meta.revisionImpacts = (meta.revisionImpacts ?? []).filter((v: any) => v.chapterId !== id);
    }
    const continuity = meta.continuity ?? { schemaVersion: 1, finalized: [], working: [] };
    if (!Array.isArray(continuity.finalized) || !Array.isArray(continuity.working)) throw new ZhizhangError("bad_continuity", "接续状态格式损坏，请核对元数据。");
    continuity.coverageNote = "只登记有来源的已处理章节；旧章未登记不代表没有定稿，须结合目录与实际正文。";
    const entry = { chapterId: id, revision, excerpt: record.body.slice(-200), at: record.updatedAt };
    continuity.finalized = continuity.finalized.filter((v: any) => v.chapterId !== id);
    continuity.working = continuity.working.filter((v: any) => v.chapterId !== id);
    if (record.body.trim()) (status === "final" ? continuity.finalized : continuity.working).push(entry);
    meta.continuity = continuity;
    const summary = {
        id: record.id,
        title: record.title,
        position: record.position,
        status: record.status,
        wordCount: record.wordCount,
        updatedAt: record.updatedAt,
        dependencies: record.dependencies,
    };
    if (existingIdx >= 0)
        meta.chapters[existingIdx] = summary;
    else
        meta.chapters.push(summary);
    meta.chapters.sort((a: any, b: any) => a.position - b.position);
    meta.updatedAt = nowIso();
    let history: string | undefined;
    if (previous && (changed || previous.revision !== revision)) {
        const before = chapterBefore;
        if (!before) throw new ZhizhangError("revision_conflict", "原稿已缺失，未覆盖。");
        history = await preserveChapter(dir, id, before);
        const next = meta.chapters.find((c: any) => c.position > position);
        const impacts = Array.isArray(meta.revisionImpacts) ? meta.revisionImpacts : [];
        const affected = new Set<string>();
        const queue = [id];
        for (let cursor = 0; cursor < queue.length; cursor++) {
            for (const chapter of meta.chapters) {
                if (chapter.id !== id && !affected.has(chapter.id) && chapter.dependencies?.some((d: any) => d.chapterId === queue[cursor])) {
                    affected.add(chapter.id); queue.push(chapter.id);
                }
            }
        }
        meta.revisionImpacts = [...impacts.filter((v: any) => v.chapterId !== id), { chapterId: id, previousRevision: previous.revision, revision, history, nextChapterId: next?.id, dependents: [...affected], at: meta.updatedAt, reason: "正文已修改；请核对已有状态记录、相关后稿与简报依据" }];
    }
    return { record, history, chapterBefore, metaBefore, chapterPath: chapterFile(dir, id), chapterContent: serializeChapterMarkdown(record), metaContent: JSON.stringify(meta, null, 2) + "\n" };
}
/** Caller holds the work lock. */
export async function saveChapterUnlocked(dir: string, input: any) {
    let ledger: any;
    const ledgerPath = path.join(dir, "ledger.json");
    const ledgerBefore = input.ledgerEntry ? await snapshotFile(ledgerPath) : null;
    if (input.ledgerEntry) ledger = await readLedger(dir);
    const prepared = await prepareChapterSaveUnlocked(dir, input);
    await mkdir(chaptersDir(dir), { recursive: true });
    const { chapterBefore, metaBefore } = prepared;
    try {
        if (ledger) {
            ledger.entries.push({ at: nowIso(), chapterId: prepared.record.id, kind: "chapter_save_direct", summary: input.ledgerEntry, history: prepared.history });
            ledger.entries = ledger.entries.slice(-LEDGER_MAX_ENTRIES);
        }
        const journal = await createChapterJournal(dir, { chapterId: prepared.record.id, writes: [
            { file: `chapters/${prepared.record.id}.md`, before: chapterBefore, content: prepared.chapterContent },
            { file: "meta.json", before: metaBefore, content: prepared.metaContent },
            ...(ledger ? [{ file: "ledger.json", before: ledgerBefore, content: JSON.stringify(ledger, null, 2) + "\n" }] : []),
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
export async function updateChapter(dir: string, input: { id: string; title?: string; body?: string; status?: string; position?: number; force?: boolean; expectedRevision?: string; ledgerEntry?: string; reviewSummary?: string; reviewResult?: "pass" | "blocked"; reviewedBy?: string; acknowledgeRevision?: boolean }) {
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
            force: input.force,
            expectedRevision: input.expectedRevision,
            reviewDeclaration: input.status === "reviewed",
            reviewSummary: input.reviewSummary,
            reviewResult: input.reviewResult,
            reviewedBy: input.reviewedBy,
            acknowledgeRevision: input.acknowledgeRevision,
            ledgerEntry: input.ledgerEntry ?? `显式保存 ${input.id}`,
        });
    });
}
