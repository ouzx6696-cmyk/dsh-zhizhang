import { assertNoPendingCard } from "../../storage/card-journal.js";
import { withResourceLock } from "../../storage/process-lock.js";
import { snapshotFile } from "../../storage/journal.js";
import { createAnalysisJournal, finishAnalysisJournal } from "../../storage/analysis-journal.js";
import { NovelError } from "../../errors.js";
/** 分析 meta / bundle / 列表。 */
import path from "node:path";
import { readdir } from "node:fs/promises";
import { atomicWrite } from "../../storage/primitives.js";
import { isMissingFileError } from "../../../../../core/src/fsx.js";
import type { StoragePaths } from "../../types.js";
import { analysisPaths, assertSourceId, ensureDir, nowIso, readJson, readJsonl } from "./paths.js";
import type { ChapterFact, Plot } from "./types.js";
import { chapterIndex, totalChapters } from "./chapters.js";

export async function ensureAnalysis(paths: StoragePaths, sourceId: string, sourceText: string) {
    return withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
    const p = analysisPaths(paths, sourceId);
    await ensureDir(p.dir);
    let meta = await readJson(p.meta, null);
    if (meta !== null && (typeof meta !== "object" || Array.isArray(meta)))
        throw new NovelError("bad_analysis", `分析元数据格式损坏：${p.meta}`);
    if (!meta) {
        const idx = chapterIndex(sourceText);
        meta = {
            schemaVersion: 2,
            sourceId,
            stage: "meta",
            scope: { mode: "none", chapters: 0 },
            totalChapters: totalChapters(idx),
            lastRead: 0,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        await atomicWrite(p.meta, `${JSON.stringify(meta, null, 2)}\n`);
        return meta;
    }
    // 旧 meta 可能因为当时的解析器只认阿拉伯数字而把 totalChapters 记成 0；
    // 这里自愈一次，避免报告/计划一直显示 0 章。
    if (!Number(meta.totalChapters)) {
        const idx = chapterIndex(sourceText);
        const total = totalChapters(idx);
        if (total > 0) {
            meta = { ...meta, totalChapters: total, updatedAt: nowIso() };
            await atomicWrite(p.meta, `${JSON.stringify(meta, null, 2)}\n`);
        }
    }
    return meta;
    });
}

export async function writeAnalysisMeta(paths: StoragePaths, sourceId: string, patch: Record<string, unknown>) {
    return withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
    const p = analysisPaths(paths, sourceId);
    const current = (await readJson(p.meta, null)) ?? { schemaVersion: 2, sourceId, stage: "meta" };
    if (typeof current !== "object" || Array.isArray(current))
        throw new NovelError("bad_analysis", `分析元数据格式损坏：${p.meta}`);
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await atomicWrite(p.meta, `${JSON.stringify(next, null, 2)}\n`);
    return next;
    });
}

/** Caller holds the library lock and has already captured the data file before reading it. */
export async function commitAnalysisUpdate(paths: StoragePaths, sourceId: string, dataFile: string, dataBefore: string | null, content: string, patch: (meta: Record<string, unknown>) => Record<string, unknown>) {
    const p = analysisPaths(paths, sourceId);
    const metaBefore = await snapshotFile(p.meta);
    const current = (await readJson(p.meta, null)) ?? { schemaVersion: 2, sourceId, stage: "meta" };
    if (!current || typeof current !== "object" || Array.isArray(current))
        throw new NovelError("bad_analysis", "拆书分析元数据格式损坏，请保留并核对。");
    const next = { ...current, ...patch(current), updatedAt: nowIso() };
    if (await snapshotFile(p.meta) !== metaBefore || await snapshotFile(path.join(p.dir, dataFile)) !== dataBefore)
        throw new NovelError("library_recovery_conflict", "拆书分析文件在准备期间变化，请重新核对。");
    const base = `analyses/${assertSourceId(sourceId)}`;
    const journal = await createAnalysisJournal(paths.library, { sourceId, dataFile, writes: [
        { file: `${base}/${dataFile}`, before: dataBefore, content },
        { file: `${base}/meta.json`, before: metaBefore, content: JSON.stringify(next, null, 2) + "\n" },
    ] });
    await finishAnalysisJournal(paths.library, journal);
}

export async function readAnalysisBundle(paths: StoragePaths, sourceId: string) {
    return withResourceLock(paths.library, async () => {
    await assertNoPendingCard(paths.library);
    const p = analysisPaths(paths, sourceId);
    const [meta, chapters, plots, rhythms, characters, survey] = await Promise.all([
        readJson(p.meta, null),
        readJsonl<ChapterFact>(p.chapters),
        readJsonl<Plot>(p.plots),
        readJson(p.rhythms, null),
        readJson(p.characters, null),
        readJson(p.survey, null),
    ]);
    if (meta !== null && (typeof meta !== "object" || Array.isArray(meta)))
        throw new NovelError("bad_analysis", `分析元数据格式损坏：${p.meta}`);
    if (characters !== null && !Array.isArray(characters))
        throw new NovelError("bad_analysis", `人物分析格式损坏：${p.characters}`);
    return {
        meta,
        chapters,
        plots,
        rhythms: rhythms ?? { schemaVersion: 2, points: [], loops: [], hooks: [], foreshadowing: [] },
        characters: Array.isArray(characters) ? characters : [],
        survey: survey ?? null,
    };
    });
}

export async function listAnalyses(paths: StoragePaths) {
    const root = path.join(paths.library, "analyses");
    let names: string[] = [];
    try {
        names = (await readdir(root)).filter((x) => x.startsWith("src-"));
    }
    catch (err: unknown) {
        if (isMissingFileError(err)) return [];
        throw err;
    }
    const items = await Promise.all(names.map(async (id) => {
        const p = analysisPaths(paths, id);
        const meta = await readJson(p.meta, null);
        if (!meta) return null;
        const [chapters, plots] = await Promise.all([readJsonl(p.chapters), readJsonl(p.plots)]);
        return {
            sourceId: assertSourceId(id),
            stage: meta.stage,
            facts: chapters.length,
            totalChapters: meta.totalChapters,
            scope: meta.scope,
            plots: plots.length,
            updatedAt: meta.updatedAt,
        };
    }));
    return items.filter((item): item is NonNullable<typeof item> => item !== null);
}
