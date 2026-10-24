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
import { listLocalBooks } from "./store.js";
function foundationFilledFields(f) {
    const keys = [
        "locks",
        "happened",
        "characters",
        "readerKnowledge",
        "planned",
        "threads",
        "style",
    ];
    return keys.filter((k) => String(f[k] ?? "").trim().length > 0);
}
export async function buildLibraryView(paths) {
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
            craftTitles: (sug.crafts ?? []).map((c) => c.title),
            emptyReason: sug.emptyReason,
        };
    }
    catch {
        combo = null;
    }
    const sourceRoot = paths.sourceRoot || "";
    let pending = [];
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
    let analyses = [];
    try {
        analyses = await listAnalyses(paths);
    }
    catch {
        analyses = [];
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
            try {
                const p = await readPlan(paths, a.sourceId);
                if (p) {
                    const prog = planProgress(p, (await readAnalysisBundle(paths, a.sourceId)).chapters);
                    plan = { mode: p.mode, ratio: p.ratio, label: planLabel(p), done: prog.done, total: prog.total };
                }
            }
            catch {
                plan = null;
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
export async function buildInspirationView(paths, opts) {
    const sessionsRaw = await InspirationPort.listSessions(paths);
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
