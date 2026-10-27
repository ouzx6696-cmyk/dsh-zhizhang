import { SCHEMA_VERSION } from "./types.js";
/** Read models for tools and panel; never imported by persistence. */
import path from "node:path";
import { readChapterLens } from "./storage/chapters.js";
import { readWorkMeta } from "./storage/work-meta.js";
import { readLedger } from "./storage/ledger.js";
import { listCandidates, readBriefCrumbs, readPayoffAudits, candidateHasLintPass } from "./work-store.js";
import { readTextCached } from "./file-cache.js";
import { assertResourceId, nowIso } from "./storage/primitives.js";
import { ZhizhangError } from "./errors.js";
import { Scheduler } from "./ports/scheduler.js";
import { BRIEF_RECENT_MS } from "./domain/constants.js";
import { renderPanelHtml } from "./panel-html.js";
const candidatesDir = (dir: string) => path.join(dir, "candidates");
function pathsFromWorkDir(dir: string) {
    const works = path.dirname(dir);
    const base = path.dirname(works);
    return {
        base,
        works,
        manuscripts: path.join(base, "manuscripts"),
        library: path.join(base, "library"),
        inspiration: path.join(base, "inspiration"),
        sourceRoot: "",
    };
}
// —— § panel snapshot ——
/** Display-only clip: snapshot/lens fields carry working text, not source of truth. */
function capText(s: any, n: number) {
    const t = String(s ?? "");
    if (t.length <= n)
        return t;
    return `${Array.from(t).slice(0, n).join("")}…`;
}
/**
 * Lens-only chapter rows for /inspiration — skips ledger/candidates/briefs/payoffs
 * and the library+inspiration views a full buildPanelSnapshot would compute.
 */
export async function listChapterLensRows(dir: string) {
    const meta = await readWorkMeta(dir);
    const rows = [];
    for (const ch of [...meta.chapters].sort((a: any, b: any) => a.position - b.position)) {
        let situationLens = "";
        let livedScene = "";
        let stateLens = "";
        try {
            const lens = await readChapterLens(dir, ch.id);
            situationLens = lens.situationLens;
            livedScene = lens.livedScene;
            stateLens = lens.stateLens;
        }
        catch {
            /* index-only */
        }
        rows.push({
            id: ch.id,
            title: ch.title,
            position: ch.position,
            status: ch.status,
            wordCount: ch.wordCount,
            situationLens,
            livedScene,
            stateLens,
        });
    }
    return rows;
}
export async function buildPanelSnapshot(dir: string, pathsHint: any, opts: any = {}) {
    const paths = pathsHint ?? pathsFromWorkDir(dir);
    const { buildLibraryView, buildInspirationView, buildProductView, } = await import("./panel-enrich.js");
    const hintsOnly = opts.hintsOnly === true;
    const meta = await readWorkMeta(dir);
    // hintsOnly 只服务 chapter_brief.full 的 nextHints：不读 ledger，也不构建
    // library / inspiration / HTML——那些是面板用的重活。
    const ledger = hintsOnly ? { entries: [] } : await readLedger(dir);
    const cands = await listCandidates(dir);
    const briefs = await readBriefCrumbs(dir);
    const payoffs = await readPayoffAudits(dir);
    const lastPayoffByChapter: Record<string, any> = {};
    for (const e of payoffs.entries) {
        lastPayoffByChapter[e.chapterId] = e;
    }
    const now = Date.now();
    const recentBriefChapterIds = new Set();
    for (const e of briefs.entries) {
        const at = Date.parse(e.at);
        if (Number.isFinite(at) && now - at <= BRIEF_RECENT_MS)
            recentBriefChapterIds.add(e.chapterId);
    }
    let words = 0;
    let final = 0;
    let drafted = 0;
    let planned = 0;
    const chapters = [];
    for (const ch of [...meta.chapters].sort((a: any, b: any) => a.position - b.position)) {
        words += ch.wordCount;
        if (ch.status === "final")
            final += 1;
        else if (ch.status === "planned")
            planned += 1;
        else
            drafted += 1;
        let situationLens = "";
        let livedScene = "";
        let stateLens = "";
        try {
            const lens = await readChapterLens(dir, ch.id);
            situationLens = capText(lens.situationLens, 400);
            livedScene = capText(lens.livedScene, 400);
            stateLens = capText(lens.stateLens, 400);
        }
        catch {
            /* index-only */
        }
        chapters.push({
            id: ch.id,
            title: ch.title,
            position: ch.position,
            status: ch.status,
            wordCount: ch.wordCount,
            situationLens,
            livedScene,
            stateLens,
            briefRecent: recentBriefChapterIds.has(ch.id),
        });
    }
    const revisionImpacts = Array.isArray(meta.revisionImpacts) ? meta.revisionImpacts : [];
    const pendingCands = cands.filter((c: any) => c.pending);
    const pending = pendingCands.length;
    const { isMultiDraftEnabled } = await import("./ports/multi-draft.js");
    const multiDraftEnabledEarly = isMultiDraftEnabled();
    const nextHints = [
        ...revisionImpacts.map((v: any) => `修订待核对：${v.chapterId}${v.nextChapterId ? ` → ${v.nextChapterId}` : ""}；${v.reason}`),
        ...(cands.some((c: any) => c.unavailable) ? ["部分候选不可读，请检查原文件；没有将损坏当作无候选。"] : []),
        ...Scheduler.panelRouteHints(),
        "采纳自动扫描；已有扫描凭据须仍有效。上下文按依据版本核对，旧格式才用时效窗口；skip_brief 可显式跳过简报门禁",
        "lint 命中>0 软警告 lint_hits_present；扫过≠过关。strict_lint / require_payoff / strict_human 可选硬拒",
        "chapter_save 大正文须 confirm_bypass；定稿：chapter_save(status=reviewed, expected_revision=已读版本) → status=final；review_ledger 只记诊断",
    ];
    if (pending > 0)
        nextHints.unshift(`有 ${pending} 条待采纳候选，可在面板点「采纳」或用 zhizhang_candidate_accept`);
    if (pendingCands.some((c: any) => c.editOf)) {
        nextHints.unshift("有编辑候选：面板可确认采纳为工作稿；内容审读和定稿另行操作，A/B/C 兼容交互可用");
    }
    if (multiDraftEnabledEarly && pending >= 2) {
        nextHints.unshift("多草稿已开启：同章≥2 待采纳可用面板「统一整理」或 unify_brief → unify_stage");
    }
    else if (!multiDraftEnabledEarly && pending >= 2) {
        nextHints.unshift("同章多份待采纳：开启 multiDraft 后可统一整理（默认关，不进主链）");
    }
    if (chapters.some((c: any) => !c.situationLens))
        nextHints.unshift("部分章节缺 situationLens，建议 zhizhang_outline_set");
    if (chapters.some((c: any) => c.wordCount > 0 && !c.briefRecent)) {
        nextHints.unshift("部分章节没有近期简报记录；写作或修订时重新获取上下文，采纳时另核实际依据版本");
    }
    const payoffWarn = Object.values(lastPayoffByChapter).filter((p: any) => !p.ok);
    if (payoffWarn.length > 0) {
        nextHints.unshift(`兑付审计有 ${payoffWarn.length} 章未过：${payoffWarn.map((p: any) => p.chapterId).join("、")}`);
    }
    if (hintsOnly)
        return { nextHints };
    // Export only the last 12 chapters' payoffs; hints above already used the full map.
    const lastPayoffCapped: Record<string, any> = {};
    for (const ch of meta.chapters) {
        if (lastPayoffByChapter[ch.id])
            lastPayoffCapped[ch.id] = lastPayoffByChapter[ch.id];
    }
    const payoffKeys = Object.keys(lastPayoffCapped);
    for (const k of payoffKeys.slice(0, Math.max(0, payoffKeys.length - 12)))
        delete lastPayoffCapped[k];
    const recentBriefs = briefs.entries.filter((e: any) => {
        const at = Date.parse(e.at);
        return Number.isFinite(at) && now - at <= BRIEF_RECENT_MS;
    });
    const product = buildProductView();
    let library;
    let inspiration;
    try {
        library = await buildLibraryView(paths);
    }
    catch (err) {
        const recoveryPending = err instanceof ZhizhangError && err.code === "library_recovery_required";
        if (recoveryPending) nextHints.unshift(err.message);
        library = {
            unavailable: true,
            recoveryPending,
            sourcesCount: 0,
            sourceRoot: paths.sourceRoot,
            pendingCount: 0,
            pending: [],
            sources: [],
            craftCount: 0,
            mindCount: 0,
            acceptedCount: 0,
            draftedCount: 0,
            combo: null,
            summary: recoveryPending ? (err as Error).message : "拆书库暂不可读，请检查库文件。",
        };
    }
    try {
        inspiration = await buildInspirationView(paths, {
            workKey: meta.key,
            foundation: meta.foundation,
            planning: meta.planning,
            chapters,
        });
    }
    catch (err) {
        inspiration = {
            unavailable: true,
            sessionsCount: 0,
            sessions: [],
            pendingEmits: 0,
            acceptedEmits: 0,
            appliedToWork: false,
            appliedCandIds: [],
            foundationFilled: false,
            foundationFilledFields: [],
            outlineProgress: {
                total: chapters.length,
                withSituation: 0,
                withLived: 0,
                withState: 0,
                complete: 0,
            },
            summary: err instanceof Error ? err.message : "灵感支柱暂不可读",
        };
    }
    const candidateRows = await Promise.all([...pendingCands, ...cands.filter((c: any) => !c.pending).slice(-20)].map(async (c: any) => {
        let hasLintPass = false;
        if (c.lintPassToken && c.lintBodyHash && c.lintedAt) {
            try {
                const id = assertResourceId(c.id, "候选 id");
                const bodyFile = typeof c.bodyFile === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(c.bodyFile) ? c.bodyFile : `${id}.md`;
                const body = await readTextCached(path.join(candidatesDir(dir), bodyFile));
                hasLintPass = candidateHasLintPass({ ...c, body });
            }
            catch { /* Missing or unreadable candidate is not a valid scan. */ }
        }
        return {
            unavailable: c.unavailable, error: c.error,
            id: c.id, chapterId: c.chapterId, stagedAt: c.stagedAt, pending: c.pending,
            wordCount: c.wordCount, note: c.note, editOf: c.editOf, editMode: c.editMode,
            draftLabel: c.draftLabel, variantGroup: c.variantGroup, unifyOf: c.unifyOf,
            hasLintPass, lintHitCount: c.lintHitCount ?? 0, source: c.source,
        };
    }));
    const multiDraftEnabled = multiDraftEnabledEarly;
    const foundationView = {
        locks: capText(meta.foundation.locks, 600),
        happened: capText(meta.foundation.happened, 600),
        threads: capText(meta.foundation.threads, 600),
        style: capText(meta.foundation.style, 600),
    };
    const continuity = meta.continuity ? { finalizedCount: meta.continuity.finalized.length, workingCount: meta.continuity.working.length, finalized: meta.continuity.finalized.slice(-8).map((v: any) => ({ chapterId: v.chapterId, revision: v.revision, at: v.at })), working: meta.continuity.working.slice(-8).map((v: any) => ({ chapterId: v.chapterId, revision: v.revision, at: v.at })) } : null;
    const ledgerRecent = ledger.entries.slice(-12).map((e: any) => ({ id: e.id, at: e.at, kind: e.kind, chapterId: e.chapterId, summary: e.summary, styleHitCount: e.styleHitCount }));
    const htmlInput = {
        workKey: meta.key,
        title: meta.title,
        genre: meta.genre,
        totals: { chapters: chapters.length, words, final, drafted, planned },
        foundation: foundationView,
        chapters,
        candidates: candidateRows,
        revisionImpacts,
        continuity,
        ledgerRecent,
        briefCrumbsRecent: recentBriefs.slice(-12),
        lastPayoffByChapter: lastPayoffCapped,
        nextHints,
        product,
        library,
        inspiration,
    };
    // HTML is only for embedding / snapshot tool output; the Web panel polls JSON and
    // never reads this field, so HTTP passes includeHtml:false to keep polling cheap.
    const html = opts.includeHtml === false ? "" : renderPanelHtml(htmlInput);
    return {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: nowIso(),
        workKey: meta.key,
        title: meta.title,
        genre: meta.genre,
        dir,
        storageBase: paths.base,
        totals: { chapters: chapters.length, words, final, drafted, planned },
        foundation: foundationView,
        chapters,
        ledgerRecent,
        candidates: candidateRows,
        revisionImpacts,
        continuity,
        multiDraftEnabled,
        briefCrumbsRecent: recentBriefs.slice(-12),
        lastPayoffByChapter: lastPayoffCapped,
        nextHints,
        product,
        library,
        inspiration,
        html,
    };
}
