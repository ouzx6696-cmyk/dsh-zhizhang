import { SCHEMA_VERSION } from "./types.js";
/** Read models for tools and panel; never imported by persistence. */
import path from "node:path";
import { readChapterLenses } from "./storage/chapters.js";
import { readWorkMeta } from "./storage/work-meta.js";
import { readLedger } from "./storage/ledger.js";
import { listCandidates, readBriefCrumbs, readPayoffAudits, candidateHasLintPass } from "./work-store.js";
import { readTextCached } from "./file-cache.js";
import { assertResourceId, nowIso } from "./storage/primitives.js";
import { ZhizhangError } from "./errors.js";
import { buildLibraryView, buildInspirationView, buildProductView } from './panel-enrich.js';
import { isMultiDraftEnabled } from './ports/multi-draft.js';
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
/** Shared chapter projection for the workbench and planning overview. */
async function chapterRows(dir: string, chapters: any[]) {
    const ordered = [...chapters].sort((a, b) => a.position - b.position);
    const lenses = await readChapterLenses(dir, ordered.map(chapter => chapter.id));
    return ordered.map((chapter, index) => {
        const { lens, error } = lenses[index];
        return {
            id: chapter.id, title: chapter.title, position: chapter.position,
            status: chapter.status, wordCount: chapter.wordCount,
            ...lens,
            situationLens: capText(lens?.situationLens ?? '', 400),
            livedScene: capText(lens?.livedScene ?? '', 400),
            stateLens: capText(lens?.stateLens ?? '', 400),
            ...(error ? { unavailable: true, error } : {}),
        };
    });
}
export async function listChapterLensRows(dir: string) {
    return chapterRows(dir, (await readWorkMeta(dir)).chapters);
}
async function readPanelWork(dir: string) {
    const [meta, cands, briefs, payoffs] = await Promise.all([
        readWorkMeta(dir), listCandidates(dir), readBriefCrumbs(dir), readPayoffAudits(dir),
    ]);
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
    const chapters = (await chapterRows(dir, meta.chapters)).map(chapter => ({ ...chapter, briefRecent: recentBriefChapterIds.has(chapter.id) }));
    for (const chapter of chapters) {
        words += chapter.wordCount;
        if (chapter.status === 'final') final++;
        else if (chapter.status === 'planned') planned++;
        else drafted++;
    }
    const revisionImpacts = Array.isArray(meta.revisionImpacts) ? meta.revisionImpacts : [];
    const pendingCands = cands.filter((c: any) => c.pending);
    const pending = pendingCands.length;
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
    if (chapters.some(chapter => chapter.unavailable)) nextHints.unshift("部分章节不可读，请检查原文件；未将读取失败当作空白正文。");
    if (chapters.some((c: any) => !c.situationLens))
        nextHints.unshift("部分章节缺 situationLens，建议 zhizhang_outline_set");
    if (chapters.some((c: any) => c.wordCount > 0 && !c.briefRecent)) {
        nextHints.unshift("部分章节没有近期简报记录；写作或修订时重新获取上下文，采纳时另核实际依据版本");
    }
    const payoffWarn = Object.values(lastPayoffByChapter).filter((p: any) => !p.ok);
    if (payoffWarn.length > 0) {
        nextHints.unshift(`兑付审计有 ${payoffWarn.length} 章未过：${payoffWarn.map((p: any) => p.chapterId).join("、")}`);
    }
    return { meta, cands, pendingCands, briefs, now, chapters, words, final, drafted, planned, revisionImpacts, nextHints, lastPayoffByChapter, multiDraftEnabledEarly };
}
export async function buildPanelHints(dir: string) {
    return { nextHints: (await readPanelWork(dir)).nextHints };
}
export async function buildPanelSnapshot(dir: string, pathsHint: any, opts: { includeHtml?: boolean; scope?: 'work' | 'all' } = {}) {
    const paths = pathsHint ?? pathsFromWorkDir(dir);
    const [work, ledger] = await Promise.all([readPanelWork(dir), readLedger(dir)]);
    const { meta, pendingCands, cands, briefs, now, chapters, words, final, drafted, planned, revisionImpacts, nextHints, lastPayoffByChapter, multiDraftEnabledEarly } = work;
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
    let library, inspiration;
    if (opts.scope !== 'work') {
        [library, inspiration] = await Promise.all([
            buildLibraryView(paths).catch(error => ({ unavailable: true, recoveryPending: error instanceof ZhizhangError && error.code === 'library_recovery_required', summary: error.message })),
            buildInspirationView(paths, { workKey: meta.key, foundation: meta.foundation, planning: meta.planning, chapters })
                .catch(error => ({ unavailable: true, summary: error.message })),
        ]);
    }
    const candidateRows = await Promise.all([...pendingCands, ...cands.filter((c: any) => !c.pending).slice(0, 20)].map(async (c: any) => {
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
            id: c.id, chapterId: c.chapterId, stagedAt: c.stagedAt, readVersion: c.readVersion, pending: c.pending,
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
        ...(library ? { library } : {}),
        ...(inspiration ? { inspiration } : {}),
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
        ...(library ? { library } : {}),
        ...(inspiration ? { inspiration } : {}),
        html,
    };
}
