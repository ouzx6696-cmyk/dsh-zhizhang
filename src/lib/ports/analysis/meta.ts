/** 分析 meta / bundle / 列表。 */
import path from "node:path";
import { readdir } from "node:fs/promises";
import { atomicWrite } from "../../store.js";
import type { StoragePaths } from "../../types.js";
import { analysisPaths, assertSourceId, ensureDir, nowIso, readJson, readJsonl } from "./paths.js";
import { chapterIndex, totalChapters } from "./chapters.js";

export async function ensureAnalysis(paths: StoragePaths, sourceId: any, sourceText: any) {
    const p = analysisPaths(paths, sourceId);
    await ensureDir(p.dir);
    let meta = await readJson(p.meta, null);
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
}

export async function writeAnalysisMeta(paths: StoragePaths, sourceId: any, patch: any) {
    const p = analysisPaths(paths, sourceId);
    const current = (await readJson(p.meta, null)) ?? { schemaVersion: 2, sourceId, stage: "meta" };
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await atomicWrite(p.meta, `${JSON.stringify(next, null, 2)}\n`);
    return next;
}

export async function readAnalysisBundle(paths: StoragePaths, sourceId: any) {
    const p = analysisPaths(paths, sourceId);
    const [meta, chapters, plots, rhythms, characters, survey] = await Promise.all([
        readJson(p.meta, null),
        readJsonl(p.chapters),
        readJsonl(p.plots),
        readJson(p.rhythms, null),
        readJson(p.characters, null),
        readJson(p.survey, null),
    ]);
    return {
        meta,
        chapters,
        plots,
        rhythms: rhythms ?? { schemaVersion: 2, points: [], loops: [], hooks: [], foreshadowing: [] },
        characters: Array.isArray(characters) ? characters : [],
        survey: survey ?? null,
    };
}

export async function listAnalyses(paths: StoragePaths) {
    const root = path.join(paths.library, "analyses");
    let names = [];
    try {
        names = (await readdir(root)).filter((x: any) => x.startsWith("src-"));
    }
    catch {
        return [];
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
