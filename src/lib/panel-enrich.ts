/**
 * Panel console enrichments — Library / Inspiration / Product summaries for snapshot + HTML.
 * Read-only; no writes.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { readJsonCached } from "./file-cache.js";
import { LibraryPort, coerceAxis } from "./ports/library.js";
import { listAnalyses, readPlan, planProgress, planLabel, readAnalysisBundle } from "./ports/analysis.js";
import { InspirationPort } from "./ports/inspiration.js";
import { ProductMap } from "./ports/product.js";
import { Scheduler } from "./ports/scheduler.js";
import { readPlanning } from "./domain/planning.js";
import { assertNoPendingInspiration } from "./storage/inspiration-journal.js";
import { listLocalBooks } from "./store.js";
import type { StoragePaths } from "./types.js";
function foundationFilledFields(f: any) {
    const keys = [
        "locks",
        "happened",
        "characters",
        "readerKnowledge",
        "planned",
        "threads",
        "style",
    ];
    return keys.filter((k: any) => String(f[k] ?? "").trim().length > 0);
}
export async function buildLibraryView(paths: StoragePaths) {
    await LibraryPort.ensureLibrary(paths);
    const sources = await LibraryPort.listSources(paths);
    const accepted = await LibraryPort.listCards(paths, { status: "accepted" });
    const drafted = await LibraryPort.listCards(paths, { status: "drafted" });
    let craftCount = 0;
    let mindCount = 0;
    for (const row of accepted) {
        let axis = row.axis;
        if (axis !== "craft" && axis !== "mind") {
            try {
                axis = coerceAxis(await LibraryPort.getCard(paths, row.id));
            }
            catch {
                axis = "craft";
            }
        }
        if (axis === "mind")
            mindCount += 1;
        else
            craftCount += 1;
    }
    let combo = null;
    try {
        const sug = await LibraryPort.suggestCombo(paths, { craftCount: 2 });
        combo = {
            ok: sug.ok,
            cardIds: sug.cardIds ?? [],
            mindTitle: sug.mind?.title ?? null,
            craftTitles: (sug.crafts ?? []).map((c: any) => c.title),
            emptyReason: sug.emptyReason,
        };
    }
    catch {
        combo = null;
    }
    const sourceRoot = paths.sourceRoot || "";
    let pending: any[] = [];
    if (sourceRoot) {
        try {
            const local = await listLocalBooks(sourceRoot, { limit: 40 });
            const titles = new Set(sources.map((s: any) => s.title));
            pending = local.filter((b: any) => !titles.has(b.title));
        }
        catch {
            pending = [];
        }
    }
    const analyses = await listAnalyses(paths);
    return {
        sourcesCount: sources.length,
        sourceRoot,
        pendingCount: pending.length,
        pending: pending.slice(0, 12).map((b: any) => ({ name: b.name, bytes: b.bytes })),
        sources: sources.slice(0, 12).map((s: any) => ({
            id: s.id,
            title: s.title,
            author: s.author ?? "",
        })),
        // Cap before the per-analysis plan/bundle reads — those are the expensive part.
        analyses: await Promise.all(analyses.slice(0, 20).map(async (a: any) => {
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
export async function buildInspirationView(paths: StoragePaths, opts: any) {
    await assertNoPendingInspiration(paths.inspiration);
    const planning = readPlanning({ planning: opts.planning });
    const sessionsRaw = await InspirationPort.listSessions(paths);
    const sessions = sessionsRaw.slice(0, 8).map((s: any) => ({
        id: s.id,
        goal: s.goal,
        genre: s.genre ?? "",
        updatedAt: s.updatedAt ?? "",
        forgeAt: s.forgeAt,
        cardCount: (s.cardIds ?? []).length,
    }));
    let pendingEmits = 0;
    let acceptedEmits = 0;
    const appliedCandIds = [];
    try {
        const candDir = path.join(paths.inspiration, "candidates");
        const names = await readdir(candDir).catch(() => []);
        for (const name of names) {
            if (!name.endsWith(".json"))
                continue;
            try {
                const raw = await readJsonCached(path.join(candDir, name));
                if (raw.status === "staged")
                    pendingEmits += 1;
                if (raw.status === "accepted")
                    acceptedEmits += 1;
                if (raw.appliedWorkKey && raw.appliedWorkKey === opts.workKey && raw.id) {
                    appliedCandIds.push(raw.id);
                }
            }
            catch {
                /* skip */
            }
        }
    }
    catch {
        /* no insp candidates */
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
            volumes: planning.volumes.slice(0, 8).map((v: any) => ({ id: v.id, title: v.title || v.id, content: v.content.slice(0, 400), truncated: v.content.length > 400, chapters: v.chapters.slice(0, 30) })),
            totalVolumes: planning.volumes.length,
            acts: planning.acts.slice(0, 8).map((a: any) => ({ id: a.id, title: a.title || a.id, volumeId: a.volumeId || "", content: a.content.slice(0, 400), truncated: a.content.length > 400, chapters: a.chapters.slice(0, 30) })),
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
        pillars: ProductMap.pillars().map((p: any) => ({
            id: p.id,
            title: p.title,
            loopStage: p.loopStage,
            summary: p.summary,
            handsOffTo: p.handsOffTo,
            status: p.status,
        })),
    };
}
