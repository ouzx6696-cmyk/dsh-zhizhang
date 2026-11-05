/**
 * Panel console enrichments — Library / Inspiration / Product summaries for snapshot + HTML.
 * Query projections never apply creative changes; underlying ports may initialize derived indexes.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJsonCached } from "./file-cache.js";
import { LibraryPort, coerceAxis } from "./ports/library.js";
import { listAnalyses, readAnalysisBundle } from "./ports/analysis/meta.js";
import { readPlan, planProgress, planLabel } from "./ports/analysis/plan.js";
import { InspirationPort, ensureInsp } from "./ports/inspiration.js";
import { ProductMap } from "./ports/product.js";
import { Scheduler } from "./ports/scheduler.js";
import { readPlanning } from "./domain/planning.js";
import { assertNoPendingInspiration } from "./storage/inspiration-journal.js";
import { listLocalBooks } from "./work-store.js";
import type { Foundation, StoragePaths } from "./types.js";
function foundationFilledFields(f: Foundation) {
    const keys = [
        "locks",
        "happened",
        "characters",
        "readerKnowledge",
        "planned",
        "threads",
        "style",
    ] as const;
    return keys.filter((k) => f[k].trim().length > 0);
}
export async function buildLibraryView(paths: StoragePaths) {
    const [sources, accepted, drafted, analyses] = await Promise.all([
        LibraryPort.listSources(paths),
        LibraryPort.listCards(paths, { status: "accepted" }),
        LibraryPort.listCards(paths, { status: "drafted" }),
        listAnalyses(paths),
    ]);
    let craftCount = 0;
    let mindCount = 0;
    const axes = await Promise.all(
        accepted.map(async (row) =>
            row.axis === "craft" || row.axis === "mind"
                ? row.axis
                : coerceAxis(await LibraryPort.getCard(paths, row.id)),
        ),
    );
    for (const axis of axes) {
        if (axis === "mind")
            mindCount += 1;
        else
            craftCount += 1;
    }
    const suggestion = await LibraryPort.suggestCombo(paths, { craftCount: 2 });
    const combo = {
        ok: suggestion.ok, cardIds: suggestion.cardIds ?? [], mindTitle: suggestion.mind?.title ?? null,
        craftTitles: (suggestion.crafts ?? []).map((card) => card.title), emptyReason: suggestion.emptyReason,
    };
    const sourceRoot = paths.sourceRoot || "";
    let pending: { name: string; bytes: number; title: string }[] = [];
    if (sourceRoot) {
        try {
            const local = await listLocalBooks(sourceRoot, { limit: 40 });
            const titles = new Set(sources.map((s) => s.title));
            pending = local.filter((b) => !titles.has(b.title));
        }
        catch {
            pending = [];
        }
    }
    return {
        sourcesCount: sources.length,
        sourceRoot,
        pendingCount: pending.length,
        pending: pending.slice(0, 12).map((b) => ({ name: b.name, bytes: b.bytes })),
        sources: sources.slice(0, 12).map((s) => ({
            id: s.id,
            title: s.title,
            author: s.author ?? "",
        })),
        // Cap before the per-analysis plan/bundle reads — those are the expensive part.
        analyses: await Promise.all(analyses.slice(0, 20).map(async (a) => {
            let plan = null;
            const p = await readPlan(paths, a.sourceId);
            if (p) {
                const prog = planProgress(p, (await readAnalysisBundle(paths, a.sourceId)).chapters);
                plan = { mode: p.mode, ratio: p.ratio, label: planLabel(p), done: prog.done, total: prog.total };
            }
            return { sourceId: a.sourceId, stage: a.stage, facts: a.facts, totalChapters: a.totalChapters, plots: a.plots, plan };
        })),
        craftCount,
        mindCount,
        acceptedCount: accepted.length,
        draftedCount: drafted.length,
        combo,
        summary: LibraryPort.summary,
    };
}
export async function buildInspirationView(
    paths: StoragePaths,
    opts: {
        workKey?: string;
        foundation: Foundation;
        planning?: unknown;
        chapters: { situationLens?: string; livedScene?: string; stateLens?: string }[];
    },
) {
    await assertNoPendingInspiration(paths.inspiration);
    const planning = readPlanning({ planning: opts.planning });
    const candDir = path.join(paths.inspiration, "candidates");
    // 冷工作区首次访问时 candidates 目录由本调用建出；先建目录再并行读，避免 readdir 撞上未创建。
    await ensureInsp(paths);
    const [sessionsRaw, names] = await Promise.all([
        InspirationPort.listSessions(paths),
        readdir(candDir),
    ]);
    const sessions = sessionsRaw.slice(0, 8).map((s) => ({
        id: s.id,
        goal: s.goal,
        genre: s.genre ?? "",
        updatedAt: s.updatedAt ?? "",
        forgeAt: s.forgeAt,
        cardCount: (s.cardIds ?? []).length,
    }));
    let pendingEmits = 0;
    let acceptedEmits = 0;
    const appliedCandIds: string[] = [];
    const jsonNames = names.filter((name) => name.endsWith(".json"));
    for (let offset = 0; offset < jsonNames.length; offset += 16) {
        const batch = jsonNames.slice(offset, offset + 16);
        const items = await Promise.all(
            batch.map(async (name) => {
                try {
                    return await readJsonCached(path.join(candDir, name));
                } catch {
                    throw new Error(`灵感候选 ${name} 不可读，请核对原文件。`);
                }
            }),
        );
        for (const raw of items) {
            if (raw.status === "staged")
                pendingEmits += 1;
            if (raw.status === "accepted")
                acceptedEmits += 1;
            if (raw.appliedWorkKey && raw.appliedWorkKey === opts.workKey && raw.id) {
                appliedCandIds.push(raw.id);
            }
        }
    }
    const filled = foundationFilledFields(opts.foundation);
    let withSituation = 0;
    let withLived = 0;
    let withState = 0;
    let complete = 0;
    for (const c of opts.chapters) {
        const sit = Boolean(c.situationLens?.trim());
        const liv = Boolean(c.livedScene?.trim());
        const st = Boolean(c.stateLens?.trim());
        if (sit)
            withSituation += 1;
        if (liv)
            withLived += 1;
        if (st)
            withState += 1;
        if (sit && liv && st)
            complete += 1;
    }
    return {
        planning: planning ? {
            book: planning.book ? { content: planning.book.content.slice(0, 400), truncated: planning.book.content.length > 400 } : null,
            volumes: planning.volumes.slice(0, 8).map((v) => ({ id: v.id, title: v.title || v.id, content: v.content.slice(0, 400), truncated: v.content.length > 400, chapters: v.chapters.slice(0, 30) })),
            totalVolumes: planning.volumes.length,
            acts: planning.acts.slice(0, 8).map((a) => ({ id: a.id, title: a.title || a.id, volumeId: a.volumeId || "", content: a.content.slice(0, 400), truncated: a.content.length > 400, chapters: a.chapters.slice(0, 30) })),
            totalActs: planning.acts.length,
        } : null,
        sessionsCount: sessionsRaw.length,
        sessions,
        pendingEmits,
        acceptedEmits,
        appliedToWork: appliedCandIds.length > 0,
        appliedCandIds: appliedCandIds.slice(0, 8),
        foundationFilled: filled.length > 0,
        foundationFilledFields: filled,
        outlineProgress: {
            total: opts.chapters.length,
            withSituation,
            withLived,
            withState,
            complete,
        },
        summary: InspirationPort.summary,
    };
}
export function buildProductView() {
    return {
        loopLine: ProductMap.loopLine(),
        writeLine: Scheduler.writeLine(),
        version: ProductMap.version,
        toolCount: ProductMap.toolCount(),
        pillars: ProductMap.pillars().map((p) => ({
            id: p.id,
            title: p.title,
            loopStage: p.loopStage,
            summary: p.summary,
            handsOffTo: p.handsOffTo,
            status: p.status,
        })),
    };
}
