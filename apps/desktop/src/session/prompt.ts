import { resolveFanqiePaths, resolveFanqieWork } from "../main/storage";
import { parseText } from "../main/ipc/validate";
import type { Focus, Target } from "../context";
import { focusLabel, promptText } from "../context";
import type {
  Chapter,
  ChapterMeta,
  Outline,
  WorkMeta,
} from "../../../../packages/fanqie/src/engine/types";
import { readChapter, readWorkMeta } from "../../../../packages/fanqie/src/engine/work-store";
import { activeProfile } from "../../../../packages/core/src/profiles";
import { exists } from "../../../../packages/core/src/fsx";
import { ArticleStore, type ArticleMeta } from "../../../../packages/toutiao/src/store";
import { toutiaoLibrary } from "../../../../packages/toutiao/src/methods";
import { fanqieLibrary } from "../../../../packages/fanqie/src/forge";
import { formatPlanningBrief } from "../../../../packages/fanqie/src/engine/domain/planning";
import {
  bodyFingerprint,
  chapterReviewInfo,
  latestReview,
  renderReview,
  type ReviewReport,
} from "../../../../packages/fanqie/src/review";
import { assertWorkspaceWritable } from "../../../../packages/core/src/workspace-lock";
import { engineTools } from "../../../../packages/fanqie/src/engine/bootstrap";
import { validPassingQa } from "../../../../packages/toutiao/src/tools";
import { SYSTEM_BRIEF } from "../../../../packages/fanqie/src/engine/tools/brief";
import { buildToutiaoBrief, TOUTIAO_EDITOR_BRIEF } from "../../../../packages/toutiao/src/brief";
import { buildFanqieBrief, FANQIE_EDITOR_BRIEF } from "../../../../packages/fanqie/src/brief";
import {
  buildMethodPack,
  type FanqieSnapshot,
  type MethodAttachmentKind,
  type ToutiaoSnapshot,
} from "../../../../packages/core/src/method-pack";
import { taskMethods, corpusMethods, packMethods, type TaskMethod } from "./task-methods";
import type { Sessions } from "./manager";

const CLIENT_NOTICE =
  "【独立客户端调用说明】当前模式与角色已启用，不调用 writer_enable。任务开头的 writer-context 是发送时的对象与已保存状态。它不是完整阅读凭据，版本变化时重读。主会话需要规划或拆书时使用 writer_plan。按任务用既有工具读取必要规划、前章和正文；压缩摘要不代替作品事实。作者切页不改变本次任务。作者明确限定素材时，立项卡、标题和正文都不得添加未提供的事实或合成人物；方法中的示范不是本次素材。局部修改必须保留范围外原文，字数和修改范围以实际保存结果核对，不满足时如实说明。工具报告过期依据或版本冲突时，重新读取当前版本并重建候选，不重复提交同一失败参数。";

export async function systemPrompt(
  target: Target,
  role: "writer" | "editor" | "planner",
  config: import("../../../../packages/toutiao/src/config").ToutiaoConfig,
) {
  if (role === "planner")
    return `你是${target.mode === "fanqie" ? "长篇" : "头条"}规划角色。按作者目标读取必要材料，完成规划或指定原文拆解，使用当前工具保存结果并回报具体对象。正文交给写手。长篇任务交接已附当前方案的方法时直接使用，需要补充目录或专项时再用 fanqie_forge_get overview 及相关方法；头条模式使用 toutiao_method_get。需要参考时检索已采纳卡、读卡全文，核对适用条件后把选定 card_ids 显式交给规划工具。没有合适参考直接按作者材料推进，不为填卡改写作者目标。`;
  const editor = role === "editor";
  const base =
    target.mode === "toutiao"
      ? editor
        ? TOUTIAO_EDITOR_BRIEF
        : await buildToutiaoBrief(
            "S5 红笔与 S6 质检使用 writer_review 派独立编辑，传入 article 和完整任务；编辑交回回报后再推进验收。",
            config,
          )
      : [
          SYSTEM_BRIEF,
          editor
            ? FANQIE_EDITOR_BRIEF
            : buildFanqieBrief(
                "使用 writer_review 派独立编辑，传入 work、chapter 和任务；按 fanqie_forge_get edit 审读，用 fanqie_review_report 交回报。",
              ),
        ].join("\n");
  return (
    base +
    "\n" +
    (role === "writer"
      ? CLIENT_NOTICE
      : "当前模式和角色已启用。读取实际稿件，按当前版本交回审读结果。")
  );
}

async function paths(host: Sessions, target: Target) {
  return resolveFanqiePaths(host.options, target);
}

export async function taskPrompt(host: Sessions, target: Target, text: string, focus: Focus) {
  if (host.options[target.mode]?.handoff?.v2 === true)
    return taskPromptV2(host, target, text, focus);
  return taskPromptV1(host, target, text, focus);
}

async function taskPromptV1(host: Sessions, target: Target, text: string, focus: Focus) {
  const profile = await activeProfile(target.mode, host.options[target.mode]?.profile);
  const intentSource = focus.intent ? "focus" : "regex";
  const intent =
    focus.intent ||
    (/审读|编辑|质检/.test(text)
      ? "review"
      : /章纲|规划|拆书|大纲/.test(text)
        ? "plan"
        : /续写|写|改|润色/.test(text)
          ? "write"
          : "inspect");
  const methods =
    target.mode === "fanqie"
      ? await taskMethods(profile.id, text, intent, host.options.fanqie?.profile)
      : [];
  let saved: unknown;
  let brief: string | undefined;
  if (target.mode === "fanqie" && target.work) {
    const storage = await paths(host, target);
    const dir = await resolveFanqieWork(host.options, target);
    const meta = await readWorkMeta(dir);
    const chapters: ChapterMeta[] = meta.chapters;
    const row = chapters.find((c) => c.id === focus.chapter);
    const chapter = row ? await readChapter(dir, row.id) : undefined;
    if (chapter && intent === "write") {
      await assertWorkspaceWritable(dir);
      const definition = engineTools({
        ...host.options.fanqie,
        storageRoot: target.root,
        worksRoot: storage.works,
      }).find((tool) => tool.name === "fanqie_chapter_brief");
      if (!definition) throw new Error("引擎工具列表里没有 fanqie_chapter_brief，无法生成交接简报");
      // handoff_only 分支固定返回 JSON 字符串；execute 类型是 unknown，在边界解析
      brief = parseText(
        await definition.execute(
          {
            work: target.work,
            chapter: chapter.id,
            brief_mode: "lean",
            handoff_only: true,
          },
          {
            name: definition.name,
            arguments: {},
            sessionId: "handoff-" + host.key(target),
            cwd: target.root,
          },
        ),
      );
    }
    const review =
      chapter && intent === "review" ? await reviewResult(host, target, focus) : undefined;
    saved = {
      brief,
      review,
      title: meta.title,
      chapters: meta.chapters.length,
      chapter: chapter
        ? {
            id: chapter.id,
            title: chapter.title,
            status: chapter.status,
            updatedAt: chapter.updatedAt,
            revision: chapter.revision,
            dependencies: chapter.dependencies || [],
            review: chapter.review
              ? { revision: chapter.review.revision, result: chapter.review.result }
              : undefined,
          }
        : undefined,
    };
  } else if (target.mode === "toutiao" && focus.article) {
    const article = await new ArticleStore(target.root).get(focus.article);
    saved = {
      article: article.id,
      status: article.status,
      revision: article.current_rev,
      qa: article.qa.at(-1),
      qaValid: await validPassingQa(new ArticleStore(target.root), article),
    };
  }
  host.extras.log?.("handoff", {
    mode: target.mode,
    intentSource,
    intent,
    methodIds: methods.map((method) => method.id),
    methodBytes: methods.reduce((sum, method) => sum + Buffer.byteLength(method.text), 0),
    briefAttached: brief !== undefined,
    briefBytes: brief === undefined ? 0 : Buffer.byteLength(brief),
  });
  return promptText(text, {
    target,
    focus,
    profile: { id: profile.id, name: profile.name },
    saved,
    methods,
    preferences: await host.extras.preferences?.(),
  });
}

// —— handoff.v2：方法包决策表接线（writer.json 的 handoff.v2 开关，默认关） ——

const DELEGATION_NOTE = "本任务是委派说明：用 writer_review 工具派编辑子会话审读，不改正文。";

/** 以方法全文落地的附件：节奏三档与病型表按 id 随方法注入，不另附文段。 */
const ATTACHMENT_METHODS: Partial<Record<MethodAttachmentKind, string>> = {
  "rhythm-excerpt": "rhythm",
  "prose-table": "prose",
};

// outline_check readiness 的会话侧同判据（判据源：packages/fanqie/skill/forge/inspiration-forge/scripts/check_outline.py）：
// 8 字段非空、目标篇幅为正、无显式占位（窄标记，普通中文括注不算占位）。
const OUTLINE_FIELDS = [
  "synopsis",
  "conflict",
  "beats",
  "ending",
  "pov",
  "locks",
  "knowledge",
] as const;
const OUTLINE_PLACEHOLDER =
  /\b(?:TODO|TBD)\b|待填写|待填充|待正文发挥|【\s*】|【[^】]*(?:待填|待补|填写|在此|工作标题|叙述位置|计划篇幅|作者锁定|人物可知|主要经历|读者经历|结果或体验|人物[^】]{0,20}边界)[^】]*】|(?:^|\n)\s*待补\s*(?=\n|$)/;

/** 章纲是否已写（8 字段任一非空）。 */
function outlineFilled(outline: Outline) {
  return OUTLINE_FIELDS.some((field) => outline[field].trim().length > 0);
}

/** 章纲是否过机械检查（fanqie_outline_check readiness 同判据）。 */
function outlinePassed(outline: Outline) {
  return (
    outline.targetWords > 0 &&
    OUTLINE_FIELDS.every((field) => outline[field].trim().length > 0) &&
    !OUTLINE_FIELDS.some((field) => OUTLINE_PLACEHOLDER.test(outline[field]))
  );
}

interface FanqieStorage {
  dir: string;
  meta: WorkMeta;
  chapter?: Chapter;
}

/** v2 快照收集：读一次作品与指向章，决策表判据与附件落地共用；没打开作品时只有 hasWork=false。 */
async function fanqieContext(
  host: Sessions,
  target: Target,
  focus: Focus,
): Promise<{ snapshot: FanqieSnapshot; storage?: FanqieStorage }> {
  const snapshot: FanqieSnapshot = { hasWork: false, chapter: null };
  if (!target.work) return { snapshot };
  const dir = await resolveFanqieWork(host.options, target);
  const meta = await readWorkMeta(dir);
  snapshot.hasWork = true;
  const row = meta.chapters.find((candidate) => candidate.id === focus.chapter);
  const chapter = row ? await readChapter(dir, row.id) : undefined;
  if (chapter) {
    const info = await chapterReviewInfo(
      dir,
      chapter.id,
      chapter.body,
      !!host.options.fanqie?.requireEditorPass,
    );
    snapshot.chapter = {
      id: chapter.id,
      hasOutline: outlineFilled(chapter.outline),
      outlinePassed: outlinePassed(chapter.outline),
      status: chapter.status,
      latestReviewPassed: info.editorReview
        ? !info.editorReview.stale && info.editorReview.verdict === "通过"
        : null,
    };
  }
  return { snapshot, storage: { dir, meta, chapter } };
}

/** v2 头条快照：文章状态、体裁线归并（微头条体裁→micro）与 S2–S4 产出判断。 */
async function toutiaoContext(
  target: Target,
  focus: Focus,
): Promise<{ store: ArticleStore; article?: ArticleMeta; snapshot: ToutiaoSnapshot }> {
  const store = new ArticleStore(target.root);
  if (!focus.article) return { store, snapshot: { article: null } };
  const article = await store.get(focus.article);
  return {
    store,
    article,
    snapshot: {
      article: {
        stage: article.status,
        contentLine:
          article.genre === "微头条" ? "micro" : article.line === "故事线" ? "story" : "news",
        hasCard: await exists(store.cardPath(article.id)),
        hasHeadline: article.headlines.main.trim().length > 0,
        hasDraft: article.drafts.length > 0,
      },
    },
  };
}

/** 上一章结尾节选：优先接续索引的末尾摘录，没有就读上一章正文结尾。 */
async function previousEnding(dir: string, meta: WorkMeta, chapterId: string) {
  const rows = [...meta.chapters].sort((a, b) => a.position - b.position);
  const index = rows.findIndex((row) => row.id === chapterId);
  const previous = index > 0 ? rows[index - 1] : undefined;
  if (!previous) return undefined;
  const excerpt = [...(meta.continuity?.finalized ?? []), ...(meta.continuity?.working ?? [])]
    .filter((entry) => entry.chapterId === previous.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
    ?.excerpt.trim();
  const tail = excerpt || (await readChapter(dir, previous.id)).body.trim().slice(-300);
  return tail ? `${previous.title}（${previous.id}）结尾节选：${tail}` : undefined;
}

/** 幕纲节选：复用写作台的规划简报渲染（全书与本章关联卷/幕，内部已截断）。 */
function actOutline(meta: WorkMeta, chapterId: string) {
  return formatPlanningBrief(meta, chapterId) || undefined;
}

/** 修改范围：回报里的 L1–L3 位置清单；回报没有定位就不附。 */
function revisionScope(report: ReviewReport) {
  return report.levels.length
    ? report.levels
        .map((level) => `${level.level} ${level.location}：${level.symptom} → ${level.fix}`)
        .join("\n")
    : undefined;
}

/** v2 附件落地：按 kind 收集回报全文、修改范围、上一章结尾与幕纲节选；拿不到材料的 kind 不输出。 */
async function fanqieAttachments(
  dir: string,
  meta: WorkMeta,
  chapter: Chapter,
  kinds: MethodAttachmentKind[],
) {
  const report =
    kinds.includes("review-report") || kinds.includes("revision-scope")
      ? await latestReview(dir, chapter.id)
      : undefined;
  const scope = report ? revisionScope(report) : undefined;
  return {
    ...(report && kinds.includes("review-report")
      ? { reviewReport: renderReview(report, report.body_sha256 !== bodyFingerprint(chapter.body)) }
      : {}),
    ...(report && kinds.includes("revision-scope") && scope ? { revisionScope: scope } : {}),
    ...(kinds.includes("previous-ending")
      ? { previousEnding: await previousEnding(dir, meta, chapter.id) }
      : {}),
    ...(kinds.includes("act-outline") ? { actOutline: actOutline(meta, chapter.id) } : {}),
  };
}

async function taskPromptV2(host: Sessions, target: Target, text: string, focus: Focus) {
  const profile = await activeProfile(target.mode, host.options[target.mode]?.profile);
  const fanqie = target.mode === "fanqie" ? await fanqieContext(host, target, focus) : undefined;
  const toutiao = target.mode === "toutiao" ? await toutiaoContext(target, focus) : undefined;
  const pack = buildMethodPack({
    mode: target.mode,
    text,
    focus,
    ...(fanqie ? { fanqie: fanqie.snapshot } : {}),
    ...(toutiao ? { toutiao: toutiao.snapshot } : {}),
  });
  const kinds = pack.attachments.map((attachment) => attachment.kind);
  const ids = [
    ...new Set([
      ...pack.methods.map((method) => method.id),
      ...kinds.flatMap((kind) => (ATTACHMENT_METHODS[kind] ? [ATTACHMENT_METHODS[kind]] : [])),
    ]),
  ];
  const pinned = host.options[target.mode]?.profile;
  const methods = await packMethods(
    target.mode === "fanqie" ? fanqieLibrary : toutiaoLibrary,
    profile.id,
    ids,
    pinned,
  );
  const corpus =
    toutiao?.snapshot.article && kinds.includes("corpus-excerpt")
      ? await corpusMethods(
          toutiaoLibrary,
          profile.id,
          toutiao.snapshot.article.contentLine,
          pinned,
        )
      : [];
  const injected: TaskMethod[] = [
    ...methods,
    ...corpus.filter((row) => !methods.some((method) => method.id === row.id)),
  ];
  let brief: string | undefined;
  let saved: Record<string, unknown> | undefined;
  if (fanqie?.storage) {
    const { dir, meta, chapter } = fanqie.storage;
    if (chapter && kinds.includes("lean-brief")) {
      await assertWorkspaceWritable(dir);
      const definition = engineTools({
        ...host.options.fanqie,
        storageRoot: target.root,
        worksRoot: (await paths(host, target)).works,
      }).find((tool) => tool.name === "fanqie_chapter_brief");
      if (!definition) throw new Error("引擎工具列表里没有 fanqie_chapter_brief，无法生成交接简报");
      // handoff_only 分支固定返回 JSON 字符串；execute 类型是 unknown，在边界解析
      brief = parseText(
        await definition.execute(
          {
            work: target.work,
            chapter: chapter.id,
            brief_mode: "lean",
            handoff_only: true,
          },
          {
            name: definition.name,
            arguments: {},
            sessionId: "handoff-" + host.key(target),
            cwd: target.root,
          },
        ),
      );
    }
    const review =
      pack.intent === "review" ||
      pack.intent === "revise" ||
      focus.intent === "review" ||
      focus.intent === "revise"
        ? await reviewResult(host, target, focus)
        : undefined;
    saved = {
      brief,
      review,
      ...(chapter ? await fanqieAttachments(dir, meta, chapter, kinds) : {}),
      title: meta.title,
      chapters: meta.chapters.length,
      chapter: chapter
        ? {
            id: chapter.id,
            title: chapter.title,
            status: chapter.status,
            updatedAt: chapter.updatedAt,
            revision: chapter.revision,
            dependencies: chapter.dependencies || [],
            review: chapter.review
              ? { revision: chapter.review.revision, result: chapter.review.result }
              : undefined,
          }
        : undefined,
    };
  } else if (toutiao?.article) {
    const article = toutiao.article;
    saved = {
      article: article.id,
      status: article.status,
      revision: article.current_rev,
      qa: article.qa.at(-1),
      qaValid: await validPassingQa(toutiao.store, article),
    };
  }
  host.extras.log?.("handoff", {
    mode: target.mode,
    intentSource: focus.intent ? "focus" : "state",
    intent: pack.intent,
    methodIds: injected.map((method) => method.id),
    methodBytes: injected.reduce((sum, method) => sum + Buffer.byteLength(method.text), 0),
    briefAttached: brief !== undefined,
    briefBytes: brief === undefined ? 0 : Buffer.byteLength(brief),
  });
  return promptText(kinds.includes("delegation-note") ? `${text}\n\n${DELEGATION_NOTE}` : text, {
    target,
    focus,
    profile: { id: profile.id, name: profile.name },
    saved,
    methods: injected,
    preferences: await host.extras.preferences?.(),
  });
}

export async function reviewResult(
  host: Sessions,
  target: Target,
  focus: Focus,
  requireCurrent = false,
) {
  let summary = "尚无对应的审读结果，请核对稿件与回报。";
  if (target.mode === "fanqie" && target.work && focus.chapter) {
    const dir = await resolveFanqieWork(host.options, target);
    const chapter = await readChapter(dir, focus.chapter);
    const info = await chapterReviewInfo(
      dir,
      focus.chapter,
      chapter.body,
      !!host.options.fanqie?.requireEditorPass,
    );
    const review = info.editorReview;
    if (requireCurrent && (!review || review.stale || review.by !== "editor"))
      throw new Error("编辑没有交回当前正文的有效审读回报，请核对已保存结果");
    summary = review
      ? `当前审读回报${review.stale ? "（对应旧正文）" : ""}：${review.verdict}，硬伤 ${review.hardIssues} 处，L1–L3 ${review.levels} 处。`
      : "尚无本章的审读回报。";
  } else if (target.mode === "toutiao" && focus.article) {
    const store = new ArticleStore(target.root),
      meta = await store.get(focus.article),
      qa = meta.qa.at(-1);
    const valid = await validPassingQa(store, meta);
    if (
      requireCurrent &&
      (!qa || qa.rev !== meta.current_rev || qa.card_sha256 !== (await store.cardSha(meta.id)))
    )
      throw new Error("编辑没有交回当前文章和立项卡版本的质检结果");
    summary = qa
      ? `质检 ${qa.score} 分，${valid.ok ? "当前有效" : valid.reason}；当前稿 rev ${meta.current_rev}。`
      : "尚无质检结果。";
  }
  return {
    target: { ...target },
    focus,
    label: focusLabel(target, focus),
    summary,
  };
}
