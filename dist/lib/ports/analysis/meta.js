import { assertNoPendingCard } from "../../storage/card-journal.js";
import { withResourceLock } from "../../storage/process-lock.js";
import { snapshotFile } from "../../storage/recovery-common.js";
import { createAnalysisJournal, finishAnalysisJournal } from "../../storage/analysis-journal.js";
import { ZhizhangError } from "../../errors.js";
/** 分析 meta / bundle / 列表。 */
import path from "node:path";
import { readdir } from "node:fs/promises";
import { atomicWrite } from "../../storage/primitives.js";
import { analysisPaths, assertSourceId, ensureDir, nowIso, readJson, readJsonl } from "./paths.js";
import { chapterIndex, totalChapters } from "./chapters.js";
export async function ensureAnalysis(paths, sourceId, sourceText) {
    return withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const p = analysisPaths(paths, sourceId);
        await ensureDir(p.dir);
        let meta = await readJson(p.meta, null);
        if (meta !== null && (typeof meta !== "object" || Array.isArray(meta)))
            throw new ZhizhangError("bad_analysis", `分析元数据格式损坏：${p.meta}`);
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
export async function writeAnalysisMeta(paths, sourceId, patch) {
    return withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const p = analysisPaths(paths, sourceId);
        const current = (await readJson(p.meta, null)) ?? { schemaVersion: 2, sourceId, stage: "meta" };
        if (typeof current !== "object" || Array.isArray(current))
            throw new ZhizhangError("bad_analysis", `分析元数据格式损坏：${p.meta}`);
        const next = { ...current, ...patch, updatedAt: nowIso() };
        await atomicWrite(p.meta, `${JSON.stringify(next, null, 2)}\n`);
        return next;
    });
}
/** Caller holds the library lock and has already captured the data file before reading it. */
export async function commitAnalysisUpdate(paths, sourceId, dataFile, dataBefore, content, patch) {
    const p = analysisPaths(paths, sourceId);
    const metaBefore = await snapshotFile(p.meta);
    const current = (await readJson(p.meta, null)) ?? { schemaVersion: 2, sourceId, stage: "meta" };
    if (!current || typeof current !== "object" || Array.isArray(current))
        throw new ZhizhangError("bad_analysis", "拆书分析元数据格式损坏，请保留并核对。");
    const next = { ...current, ...patch(current), updatedAt: nowIso() };
    if (await snapshotFile(p.meta) !== metaBefore || await snapshotFile(path.join(p.dir, dataFile)) !== dataBefore)
        throw new ZhizhangError("library_recovery_conflict", "拆书分析文件在准备期间变化，请重新核对。");
    const base = `analyses/${assertSourceId(sourceId)}`;
    const journal = await createAnalysisJournal(paths.library, { sourceId, dataFile, writes: [
            { file: `${base}/${dataFile}`, before: dataBefore, content },
            { file: `${base}/meta.json`, before: metaBefore, content: JSON.stringify(next, null, 2) + "\n" },
        ] });
    try {
        await finishAnalysisJournal(paths.library, journal);
    }
    catch (err) {
        if (err instanceof ZhizhangError)
            throw err;
        throw new ZhizhangError("library_recovery_required", `拆书分析更新未完成（${err?.message ?? String(err)}）。请先检查恢复记录。`);
    }
}
export async function readAnalysisBundle(paths, sourceId) {
    return withResourceLock(paths.library, async () => {
        await assertNoPendingCard(paths.library);
        const p = analysisPaths(paths, sourceId);
        const [meta, chapters, plots, rhythms, characters, survey] = await Promise.all([
            readJson(p.meta, null),
            readJsonl(p.chapters),
            readJsonl(p.plots),
            readJson(p.rhythms, null),
            readJson(p.characters, null),
            readJson(p.survey, null),
        ]);
        if (meta !== null && (typeof meta !== "object" || Array.isArray(meta)))
            throw new ZhizhangError("bad_analysis", `分析元数据格式损坏：${p.meta}`);
        if (characters !== null && !Array.isArray(characters))
            throw new ZhizhangError("bad_analysis", `人物分析格式损坏：${p.characters}`);
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
export async function listAnalyses(paths) {
    const root = path.join(paths.library, "analyses");
    let names = [];
    try {
        names = (await readdir(root)).filter((x) => x.startsWith("src-"));
    }
    catch (err) {
        if (err?.code === "ENOENT")
            return [];
        throw err;
    }
    const out = [];
    for (const id of names) {
        const p = analysisPaths(paths, id);
        const meta = await readJson(p.meta, null);
        if (!meta)
            continue;
        const chapters = await readJsonl(p.chapters);
        const plots = await readJsonl(p.plots);
        out.push({
            sourceId: assertSourceId(id),
            stage: meta.stage,
            facts: chapters.length,
            totalChapters: meta.totalChapters,
            scope: meta.scope,
            plots: plots.length,
            updatedAt: meta.updatedAt,
        });
    }
    return out;
}
