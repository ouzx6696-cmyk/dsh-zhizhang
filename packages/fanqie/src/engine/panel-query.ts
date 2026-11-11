import { assertCandidateFile } from "./storage/primitives.js";
import { writingActivity } from "./dashboard-query.js";
import {
  type ChapterMeta,
  type ForeshadowStatus,
  type HandoffRecord,
  type KnowledgeLevel,
  type StoragePaths,
  type WorkMeta,
  SCHEMA_VERSION,
} from "./types.js";
/** Read models for tools and panel; never imported by persistence. */
import path from "node:path";
import { readChapter, readChapterLenses } from "./storage/chapters.js";
import { readWorkMeta } from "./storage/work-meta.js";
import { readLedger } from "./storage/ledger.js";
import { listHandoffs, readForeshadow, readKnowledge } from "./storage/continuity.js";
import {
  listCandidates,
  readBriefCrumbs,
  readPayoffAudits,
  candidateHasLintPass,
} from "./work-store.js";
import { readTextCached } from "./file-cache.js";
import { assertResourceId, nowIso } from "./storage/primitives.js";
import { NovelError } from "./errors.js";
import { forgottenForeshadows, knowledgeBreachCandidates } from "./domain/continuity.js";
import { buildLibraryView, buildInspirationView, buildProductView } from "./panel-enrich.js";
import { isContinuityEnabled } from "./ports/continuity.js";
import { isMultiDraftEnabled } from "./ports/multi-draft.js";
import { Scheduler } from "./ports/scheduler.js";
import { PATROL_WINDOW, patrolRhythm, type RhythmPatrolCandidate } from "./rhythm-patrol.js";
import { BRIEF_RECENT_MS } from "./domain/constants.js";
const candidatesDir = (dir: string) => path.join(dir, "candidates");
function pathsFromWorkDir(dir: string): StoragePaths {
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
function capText(text: string, limit: number) {
  let end = 0,
    count = 0;
  for (const character of text) {
    if (count++ === limit) return text.slice(0, end) + "…";
    end += character.length;
  }
  return text;
}
/** Shared chapter projection for the workbench and planning overview. */
async function chapterRows(dir: string, chapters: ChapterMeta[]) {
  const ordered = [...chapters].sort((a, b) => a.position - b.position);
  const lenses = await readChapterLenses(
    dir,
    ordered.map((chapter) => chapter.id),
  );
  return ordered.map((chapter, index) => {
    const { lens, error } = lenses[index];
    return {
      id: chapter.id,
      title: chapter.title,
      position: chapter.position,
      status: chapter.status,
      wordCount: chapter.wordCount,
      ...lens,
      situationLens: capText(lens?.situationLens ?? "", 400),
      livedScene: capText(lens?.livedScene ?? "", 400),
      stateLens: capText(lens?.stateLens ?? "", 400),
      ...(error ? { unavailable: true, error } : {}),
    };
  });
}
export async function listChapterLensRows(dir: string) {
  return chapterRows(dir, (await readWorkMeta(dir)).chapters);
}
// —— § continuity view (T11) ——
/** 开关开时快照的 continuityView 段：伏笔线清单、知识边界、最近章末交接与知情越界候选数。 */
interface ContinuityView {
  lines: Array<{
    id: string;
    title: string;
    seed: string;
    plannedPlant: number;
    plannedPayoff: number;
    status: ForeshadowStatus;
    beats: number[];
  }>;
  knowledge: Array<{
    id: string;
    fact: string;
    holders: Array<{ who: string; level: KnowledgeLevel; since: number }>;
  }>;
  handoff: { chapter: string; summary: string; mustCarry: string[]; openLoops: string[] } | null;
  breachCount: number;
}
/** 每类巡检候选进提示的上限，防刷屏。 */
const CONTINUITY_HINT_CAP = 3;
/** 三类节奏候选的人话版（panelHints 用；nextHints 直接带 evidence）。 */
const PATROL_PLAIN: Record<
  RhythmPatrolCandidate["kind"],
  (candidate: RhythmPatrolCandidate) => string
> = {
  same_conflict_run: (c) => `连续多章（${c.chapters.join("、")}）用同一种冲突模式，建议回规划重排`,
  no_perceptible_change: (c) => `第 ${c.chapters.join("、第 ")} 章连在一起没有可感变化`,
  pressure_over_cap: (c) =>
    `受压连跑 ${c.chapters.length} 章（${c.chapters.join("、")}），超过档位上限`,
};
/**
 * 开关开时读 continuity/ 数据并跑巡检，供快照段（view）与提示（forgotten/breaches/patrol）共用。
 * 受压计数来自显式章纲；旧作品未记录时不推断受压。
 */
async function continuityPatrol(dir: string, meta: WorkMeta) {
  const [foreshadow, knowledge, handoffs] = await Promise.all([
    readForeshadow(dir),
    readKnowledge(dir),
    listHandoffs(dir),
  ]);
  const written = [...meta.chapters].sort((a, b) => a.position - b.position);
  const withBody = written.filter((c) => c.wordCount > 0);
  const chapters = withBody.length
    ? await Promise.all(withBody.map((c) => readChapter(dir, c.id)))
    : [];
  const breaches = knowledgeBreachCandidates(
    knowledge.items,
    chapters.map((c) => ({ position: c.position, body: c.body })),
  );
  const patrol = patrolRhythm({
    pace: meta.pace,
    chapters: chapters.slice(-PATROL_WINDOW).map((c) => ({
      chapterId: c.id,
      conflict: c.outline.conflict,
      progression: [c.outline.beats, c.outline.ending]
        .map((part) => part.trim())
        .filter(Boolean)
        .join("\n"),
      pressureCount: c.outline.pressure ?? 0,
    })),
  });
  const latest = handoffs.reduce<HandoffRecord | undefined>(
    (acc, h) => (!acc || h.at > acc.at ? h : acc),
    undefined,
  );
  const view: ContinuityView = {
    lines: foreshadow.lines.map((line) => ({
      id: line.id,
      title: line.title,
      seed: line.seed,
      plannedPlant: line.plannedPlant,
      plannedPayoff: line.plannedPayoff,
      status: line.status,
      beats: line.beats.map((beat) => beat.chapter),
    })),
    knowledge: knowledge.items.map((item) => ({
      id: item.id,
      fact: item.fact,
      holders: item.holders.map((h) => ({ who: h.who, level: h.level, since: h.since })),
    })),
    handoff: latest
      ? {
          chapter: latest.chapter,
          summary: latest.summary,
          mustCarry: latest.mustCarry,
          openLoops: latest.openLoops,
        }
      : null,
    breachCount: breaches.length,
  };
  return {
    view,
    forgotten: forgottenForeshadows(foreshadow.lines, withBody.at(-1)?.position ?? 0),
    breaches,
    patrol: patrol.candidates,
  };
}
async function readPanelWork(dir: string) {
  const [meta, cands, briefs, payoffs] = await Promise.all([
    readWorkMeta(dir),
    listCandidates(dir),
    readBriefCrumbs(dir),
    readPayoffAudits(dir),
  ]);
  const lastPayoffByChapter: Record<string, (typeof payoffs.entries)[number]> = {};
  for (const e of payoffs.entries) {
    lastPayoffByChapter[e.chapterId] = e;
  }
  const now = Date.now();
  const recentBriefChapterIds = new Set();
  for (const e of briefs.entries) {
    const at = Date.parse(e.at);
    if (Number.isFinite(at) && now - at <= BRIEF_RECENT_MS) recentBriefChapterIds.add(e.chapterId);
  }
  let words = 0;
  let final = 0;
  let drafted = 0;
  let planned = 0;
  const chapters = (await chapterRows(dir, meta.chapters)).map((chapter) => ({
    ...chapter,
    briefRecent: recentBriefChapterIds.has(chapter.id),
  }));
  for (const chapter of chapters) {
    words += chapter.wordCount;
    if (chapter.status === "final") final++;
    else if (chapter.status === "planned") planned++;
    else drafted++;
  }
  const revisionImpacts = meta.revisionImpacts ?? [];
  const pendingCands = cands.filter((c) => c.pending);
  const pending = pendingCands.length;
  const multiDraftEnabledEarly = isMultiDraftEnabled();
  const continuity = isContinuityEnabled() ? await continuityPatrol(dir, meta) : null;
  const nextHints = [
    ...revisionImpacts.map(
      (v) =>
        `修订待核对：${v.chapterId}${v.nextChapterId ? ` → ${v.nextChapterId}` : ""}；${v.reason}`,
    ),
    ...(cands.some((c) => c.unavailable)
      ? ["部分候选不可读，请检查原文件；没有将损坏当作无候选。"]
      : []),
    ...Scheduler.panelRouteHints(),
    "采纳自动扫描；已有扫描凭据须仍有效。上下文按依据版本核对，旧格式才用时效窗口；skip_brief 可显式跳过简报门禁",
    "lint 命中>0 软警告 lint_hits_present；扫过≠过关。strict_lint / require_payoff / strict_human 可选硬拒",
    "chapter_save 大正文须 confirm_bypass；定稿：chapter_save(status=reviewed, expected_revision=已读版本) → status=final；review_ledger 只记诊断",
  ];
  if (pending > 0)
    nextHints.unshift(`有 ${pending} 条待采纳候选，可在面板点「采纳」或用 fanqie_candidate_accept`);
  if (pendingCands.some((c) => c.editOf)) {
    nextHints.unshift(
      "有编辑候选：面板可确认采纳为工作稿；内容审读和定稿另行操作，A/B/C 兼容交互可用",
    );
  }
  if (multiDraftEnabledEarly && pending >= 2) {
    nextHints.unshift(
      "多草稿已开启：同章≥2 待采纳可用面板「统一整理」或 unify_brief → unify_stage",
    );
  } else if (!multiDraftEnabledEarly && pending >= 2) {
    nextHints.unshift("同章多份待采纳：开启 multiDraft 后可统一整理（默认关，不进主链）");
  }
  // A-04: older versions could write two chapters at one position; report, never auto-renumber.
  const seen = new Map<number, string>(),
    duplicates: string[] = [];
  for (const chapter of chapters) {
    const other = seen.get(chapter.position);
    if (other !== undefined) duplicates.push(`${other}/${chapter.id}@${chapter.position}`);
    else seen.set(chapter.position, chapter.id);
  }
  if (duplicates.length)
    nextHints.unshift(
      `章节位置重复（${duplicates.slice(0, 5).join("、")}）：排序可能不稳定；用 fanqie_chapter_save(position=…) 把其中一章移到空位，系统不会自动改号。`,
    );
  if (chapters.some((chapter) => chapter.unavailable))
    nextHints.unshift("部分章节不可读，请检查原文件；未将读取失败当作空白正文。");
  if (chapters.some((c) => !c.situationLens))
    nextHints.unshift("部分章节缺 situationLens，建议 fanqie_outline_set");
  if (chapters.some((c) => c.wordCount > 0 && !c.briefRecent)) {
    nextHints.unshift(
      "部分章节没有近期简报记录；写作或修订时重新获取上下文，采纳时另核实际依据版本",
    );
  }
  const payoffWarn = Object.values(lastPayoffByChapter).filter((p) => !p.ok);
  // 连续性巡检（开关开）：nextHints 带证据句；每类最多 CONTINUITY_HINT_CAP 条，防刷屏。
  if (continuity) {
    nextHints.unshift(
      ...continuity.forgotten
        .slice(0, CONTINUITY_HINT_CAP)
        .map(
          (line) =>
            `被遗忘伏笔：${line.id}《${line.title}》计划第 ${line.plannedPayoff} 章回收，状态仍是 ${line.status}；用 fanqie_continuity_commit 补核验或与作者确认改线`,
        ),
      ...continuity.breaches
        .slice(0, CONTINUITY_HINT_CAP)
        .map(
          (b) =>
            `知情越界候选：第 ${b.chapter} 章「${b.who}」按登记应是「不知」，正文却与事实「${b.fact}」同段出现：${b.quote}`,
        ),
      ...continuity.patrol
        .slice(0, CONTINUITY_HINT_CAP)
        .map((c) => `节奏巡检候选：${c.chapters.join("、")}；${c.evidence}`),
    );
  }
  if (payoffWarn.length > 0) {
    nextHints.unshift(
      `兑付审计有 ${payoffWarn.length} 章未过：${payoffWarn.map((p) => p.chapterId).join("、")}`,
    );
  }

  // Author-facing route hints for the writing panel. Model hints above keep tool names on purpose.
  const panelHints = [
    ...revisionImpacts.map(
      (v) =>
        `第 ${v.chapterId} 章有修订待核对${v.nextChapterId ? `，并影响 ${v.nextChapterId}` : ""}`,
    ),
    ...(cands.some((c) => c.unavailable) ? ["有候选文件读取失败，请检查原文件"] : []),
  ];
  if (pending > 0) panelHints.unshift(`有 ${pending} 份候选等待采纳，可在右栏选择并采纳`);
  if (pendingCands.some((c) => c.editOf)) {
    panelHints.unshift("有一份编辑修订稿，核对后可在右栏采纳为工作稿");
  }
  if (multiDraftEnabledEarly && pending >= 2) {
    panelHints.unshift("同章有多份候选，可在右栏使用「统一整理」");
  } else if (!multiDraftEnabledEarly && pending >= 2) {
    panelHints.unshift("同章有多份候选；在设置中开启「多草稿整理」后可统一处理");
  }
  if (chapters.some((chapter) => chapter.unavailable))
    panelHints.unshift("有章节文件读取失败，请检查原文件");
  if (chapters.some((c) => !c.situationLens))
    panelHints.unshift("有章节缺少「处境透镜」，可在命令面板补全章纲");
  if (chapters.some((c) => c.wordCount > 0 && !c.briefRecent)) {
    panelHints.unshift("有章节缺少近期写作简报；写作或修订时会重新获取上下文");
  }
  // 人话版巡检提示，与 payoffWarn 并列。
  if (continuity) {
    panelHints.unshift(
      ...continuity.forgotten
        .slice(0, CONTINUITY_HINT_CAP)
        .map((line) => `伏笔《${line.title}》计划第 ${line.plannedPayoff} 章回收，还没核验到兑现`),
      ...continuity.breaches
        .slice(0, CONTINUITY_HINT_CAP)
        .map((b) => `第 ${b.chapter} 章「${b.who}」可能提前知道了「${b.fact}」，请核对`),
      ...continuity.patrol.slice(0, CONTINUITY_HINT_CAP).map((c) => PATROL_PLAIN[c.kind](c)),
    );
  }
  if (payoffWarn.length > 0)
    panelHints.unshift(
      `伏笔兑付核对有 ${payoffWarn.length} 章未通过：${payoffWarn.map((p) => p.chapterId).join("、")}`,
    );
  return {
    meta,
    cands,
    pendingCands,
    briefs,
    now,
    chapters,
    words,
    final,
    drafted,
    planned,
    revisionImpacts,
    nextHints,
    panelHints,
    lastPayoffByChapter,
    multiDraftEnabledEarly,
    continuity,
  };
}
export async function buildPanelHints(dir: string) {
  return { nextHints: (await readPanelWork(dir)).nextHints };
}
export async function buildPanelSnapshot(
  dir: string,
  pathsHint?: StoragePaths | null,
  opts: { scope?: "work" | "all" } = {},
) {
  const paths = pathsHint ?? pathsFromWorkDir(dir);
  const [work, ledger] = await Promise.all([readPanelWork(dir), readLedger(dir)]);
  const {
    meta,
    pendingCands,
    cands,
    briefs,
    now,
    chapters,
    words,
    final,
    drafted,
    planned,
    revisionImpacts,
    nextHints,
    panelHints,
    lastPayoffByChapter,
    multiDraftEnabledEarly,
    continuity: continuityPatrolResult,
  } = work;
  // Export only the last 12 chapters' payoffs; hints above already used the full map.
  const lastPayoffCapped: Record<string, (typeof lastPayoffByChapter)[string]> = {};
  for (const ch of meta.chapters) {
    if (lastPayoffByChapter[ch.id]) lastPayoffCapped[ch.id] = lastPayoffByChapter[ch.id];
  }
  const payoffKeys = Object.keys(lastPayoffCapped);
  for (const k of payoffKeys.slice(0, Math.max(0, payoffKeys.length - 12)))
    delete lastPayoffCapped[k];
  const recentBriefs = briefs.entries.filter((e) => {
    const at = Date.parse(e.at);
    return Number.isFinite(at) && now - at <= BRIEF_RECENT_MS;
  });
  const product = buildProductView();
  let library, inspiration, activity;
  if (opts.scope !== "work") {
    [library, inspiration, activity] = await Promise.all([
      // allow-catch: optional library summary returns unavailable with the actual error to the author.
      buildLibraryView(paths).catch((error) => ({
        unavailable: true,
        recoveryPending: error instanceof NovelError && error.code === "library_recovery_required",
        summary: error.message,
      })),
      // allow-catch: optional planning summary returns unavailable with the actual error.
      buildInspirationView(paths, {
        workKey: meta.key,
        foundation: meta.foundation,
        planning: meta.planning,
        chapters,
      }).catch((error) => ({ unavailable: true, summary: error.message })),
      // allow-catch: optional activity view surfaces its error instead of inventing zero activity.
      writingActivity(dir, meta.chapters).catch((error) => ({
        unavailable: true,
        error: error.message,
      })),
    ]);
  }
  const candidateRows = await Promise.all(
    [...pendingCands, ...cands.filter((c) => !c.pending).slice(0, 20)].map(async (c) => {
      let hasLintPass = false;
      if (c.lintPassToken && c.lintBodyHash && c.lintedAt) {
        try {
          const id = assertResourceId(c.id, "候选 id");
          const bodyFile = assertCandidateFile(c.bodyFile ?? `${id}.md`);
          const body = await readTextCached(path.join(candidatesDir(dir), bodyFile));
          hasLintPass = candidateHasLintPass({ ...c, body });
        } catch (error) {
          c.unavailable = true;
          c.error = error instanceof Error ? error.message : String(error);
        }
      }
      return {
        unavailable: c.unavailable,
        error: c.error,
        id: c.id,
        chapterId: c.chapterId,
        stagedAt: c.stagedAt,
        readVersion: c.readVersion,
        pending: c.pending,
        wordCount: c.wordCount,
        note: c.note,
        editOf: c.editOf,
        editMode: c.editMode,
        draftLabel: c.draftLabel,
        variantGroup: c.variantGroup,
        unifyOf: c.unifyOf,
        hasLintPass,
        lintHitCount: c.lintHitCount ?? 0,
        source: c.source,
      };
    }),
  );
  const multiDraftEnabled = multiDraftEnabledEarly;
  const foundationView = {
    locks: capText(meta.foundation.locks, 600),
    happened: capText(meta.foundation.happened, 600),
    threads: capText(meta.foundation.threads, 600),
    style: capText(meta.foundation.style, 600),
  };
  const continuity = meta.continuity
    ? {
        finalizedCount: meta.continuity.finalized.length,
        workingCount: meta.continuity.working.length,
        finalized: meta.continuity.finalized
          .slice(-8)
          .map((v) => ({ chapterId: v.chapterId, revision: v.revision, at: v.at })),
        working: meta.continuity.working
          .slice(-8)
          .map((v) => ({ chapterId: v.chapterId, revision: v.revision, at: v.at })),
      }
    : null;
  // 改稿学习候选数（learn-task.ts 写 learn-pending.json）；缺文件或空时不出现在快照
  let learnPendingCount = 0;
  try {
    const pending: unknown = JSON.parse(await readTextCached(path.join(dir, "learn-pending.json")));
    if (pending && typeof pending === "object" && !Array.isArray(pending)) {
      const items = (pending as { items?: unknown }).items;
      learnPendingCount = Array.isArray(items) ? items.length : 0;
    }
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }

  const ledgerRecent = ledger.entries.slice(-12).map((e) => ({
    id: e.id,
    at: e.at,
    kind: e.kind,
    chapterId: e.chapterId,
    summary: e.summary,
    styleHitCount: e.styleHitCount,
  }));
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: nowIso(),
    workKey: meta.key,
    title: meta.title,
    genre: meta.genre,
    dir,
    storageBase: paths.base,
    activity,
    totals: { chapters: chapters.length, words, final, drafted, planned },
    foundation: foundationView,
    chapters,
    volumes: (meta.planning?.volumes || []).map((volume) => ({
      id: volume.id,
      title: volume.title,
      chapters: volume.chapters,
    })),
    ledgerRecent,
    candidates: candidateRows,
    revisionImpacts,
    continuity,
    multiDraftEnabled,
    briefCrumbsRecent: recentBriefs.slice(-12),
    lastPayoffByChapter: lastPayoffCapped,
    nextHints,
    panelHints,
    product,
    ...(learnPendingCount > 0 ? { learnPending: learnPendingCount } : {}),
    ...(continuityPatrolResult ? { continuityView: continuityPatrolResult.view } : {}),
    ...(library ? { library } : {}),
    ...(inspiration ? { inspiration } : {}),
  };
}
