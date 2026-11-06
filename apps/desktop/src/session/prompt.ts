import { resolveFanqiePaths, resolveFanqieWork } from "../main/storage";
import type { Focus, Target } from "../context";
import { focusLabel, promptText } from "../context";
import type { ChapterMeta } from "../../../../packages/fanqie/src/engine/types";
import { readChapter, readWorkMeta } from "../../../../packages/fanqie/src/engine/work-store";
import { activeProfile } from "../../../../packages/core/src/profiles";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { chapterReviewInfo } from "../../../../packages/fanqie/src/review";
import { assertWorkspaceWritable } from "../../../../packages/core/src/workspace-lock";
import { engineTools } from "../../../../packages/fanqie/src/engine/bootstrap";
import { validPassingQa } from "../../../../packages/toutiao/src/tools";
import { SYSTEM_BRIEF } from "../../../../packages/fanqie/src/engine/tools/brief";
import { buildToutiaoBrief, TOUTIAO_EDITOR_BRIEF } from "../../../../packages/toutiao/src/brief";
import { buildFanqieBrief, FANQIE_EDITOR_BRIEF } from "../../../../packages/fanqie/src/brief";
import { taskMethods } from "./task-methods";
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
  const profile = await activeProfile(target.mode, host.options[target.mode]?.profile);
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
  if (target.mode === "fanqie" && target.work) {
    const storage = await paths(host, target);
    const dir = await resolveFanqieWork(host.options, target);
    const meta = await readWorkMeta(dir);
    const chapters: ChapterMeta[] = meta.chapters;
    const row = chapters.find((c) => c.id === focus.chapter);
    const chapter = row ? await readChapter(dir, row.id) : undefined;
    let brief: unknown;
    if (chapter && intent === "write") {
      await assertWorkspaceWritable(dir);
      const definition = engineTools({
        ...host.options.fanqie,
        storageRoot: target.root,
        worksRoot: storage.works,
      }).find((tool) => tool.name === "fanqie_chapter_brief");
      if (!definition) throw new Error("引擎工具列表里没有 fanqie_chapter_brief，无法生成交接简报");
      brief = await definition.execute(
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
  return promptText(text, {
    target,
    focus,
    profile: { id: profile.id, name: profile.name },
    saved,
    methods,
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
