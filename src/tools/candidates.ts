/** Writing pillar — candidate stage / edit / accept. */
import {
  acceptCandidate,
  countWords,
  getRecentBrief,
  getRecentPayoffAudit,
  listChapters,
  readCandidate,
  readChapter,
  readWorkMeta,
  stageCandidate,
  type StoragePaths,
} from "../lib/store.js";
import {
  AcceptPolicy,
  EditPort,
  FoundationPort,
  InspirationPort,
  Scheduler,
  auditHumanFeel,
  coerceAxis,
  coerceHumanFeel,
  craftCueFromHumanFeel,
  firstDenyCode,
  firstDenyText,
  getPortConfig,
} from "../lib/ports/index.js";
import { asString, fail, openWork } from "./context.js";
import { B, E, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool, type ToolDef } from "./types.js";

async function resolveCraftCue(
  paths: StoragePaths,
  key: string,
): Promise<string> {
  try {
    const resolved = await InspirationPort.resolveCardsForBrief(paths, {
      workKey: key,
      limit: 5,
    });
    return resolved.cards
      .filter((c) => coerceAxis(c) === "craft")
      .map((c) =>
        craftCueFromHumanFeel(
          coerceHumanFeel(c.humanFeel as Record<string, unknown> | undefined),
        ),
      )
      .join("\n");
  } catch {
    return "";
  }
}

async function resolvePrevBody(dir: string, chapterId: string): Promise<string | null> {
  try {
    const chapters = await listChapters(dir);
    const idx = chapters.findIndex((c) => c.id === chapterId);
    if (idx > 0) {
      const prev = await readChapter(dir, chapters[idx - 1]!.id);
      return prev.body || null;
    }
    if (idx < 0 && chapters.length > 0) {
      const last = chapters[chapters.length - 1]!;
      if (last.id !== chapterId) {
        const prev = await readChapter(dir, last.id);
        return prev.body || null;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function runAcceptPipeline(
  args: Record<string, unknown>,
  exec: unknown,
  opts: {
    candidateId: string;
    mode: "replace" | "append";
    force: boolean;
    lintPassToken?: string;
    skipBrief: boolean;
    strictLint: boolean;
    requirePayoff: boolean;
    strictHuman: boolean;
    strictNovel: boolean;
    acceptAfterEdit: boolean;
    confirmAcceptAfterEdit: boolean;
  },
): Promise<string> {
  const { paths, dir, key } = await openWork(exec, args);
  const candMeta = await readCandidate(dir, opts.candidateId);

  const brief = await getRecentBrief(dir, candMeta.chapterId);
  const payoff = await getRecentPayoffAudit(dir, candMeta.chapterId);
  const craftCue = await resolveCraftCue(paths, key);
  const prevBody = await resolvePrevBody(dir, candMeta.chapterId);

  const gate = AcceptPolicy.evaluate({
    candidate: candMeta,
    brief,
    payoff,
    skipBrief: opts.skipBrief,
    strictLint: opts.strictLint,
    requirePayoff: opts.requirePayoff,
    strictHuman: opts.strictHuman,
    strictNovel: opts.strictNovel,
    prevBody,
    craftCue,
    acceptAfterEdit: opts.acceptAfterEdit,
    confirmAcceptAfterEdit: opts.confirmAcceptAfterEdit,
  });
  if (!gate.ok) fail(firstDenyText(gate), firstDenyCode(gate));

  const saved = await acceptCandidate(dir, opts.candidateId, opts.mode, {
    force: opts.force,
    lintPassToken: opts.lintPassToken,
  });

  let ending = "";
  let body = "";
  try {
    const ch = await readChapter(dir, saved.id);
    ending = ch.outline.ending || "";
    body = ch.body || "";
  } catch {
    ending = "";
    body = "";
  }
  const resolved = FoundationPort.resolveHappenedText({ ending, body });
  const meta = await readWorkMeta(dir);
  const append = await FoundationPort.appendHappened(dir, {
    chapterId: saved.id,
    title: saved.title,
    text: resolved.text,
  });
  const happenedLines = FoundationPort.acceptReceiptLines({
    chapterId: saved.id,
    title: saved.title,
    ending,
    threads: meta.foundation.threads,
    append,
    happenedSource: resolved.source,
    endingVsBodyWarn: resolved.warn,
  });

  const lines = [
    `已采纳 ${opts.candidateId} →「${saved.title}」（${saved.id}），${saved.wordCount} 字，状态 ${saved.status}。仍需作者审校/定稿。`,
    ...gate.receiptLines,
    ...happenedLines,
    `下一步：${Scheduler.nextHint("candidate_accept")}`,
  ];
  return lines.join("\n");
}

export function candidatesTools(): ToolDef[] {
  return [
    defineTool({
      name: "zhizhang_candidate_stage",
      description:
        "【默认链】暂存候选到 candidates/（不写 chapters/）。下一步：style_lint(candidate) →（可选 edit）→ candidate_accept。",
      properties: {
        work: WORK_OPT,
        working_dir: WORKING_DIR,
        chapter: S("目标章节 id"),
        content: S("候选全文"),
        note: S("可选说明"),
      },
      required: ["chapter", "content"],
      async execute(args, exec) {
        const chapterId = asString(args, "chapter", { required: true })!;
        const content = asString(args, "content", { required: true, trim: false })!;
        if (!content.trim()) fail("content 不能为空");
        const { dir } = await openWork(exec, args);
        const cand = await stageCandidate(dir, {
          chapterId,
          body: content,
          note: asString(args, "note") ?? "",
          source: "agent",
        });
        return [
          `候选已暂存：${cand.id}`,
          `- 目标章：${cand.chapterId}`,
          `- 约 ${countWords(cand.body)} 字`,
          `- 尚未写入章节；确认后调用 zhizhang_candidate_accept`,
          `下一步：${Scheduler.nextHint("candidate_stage")}`,
        ].join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_candidate_edit_brief",
      description:
        "【默认链·可选编辑】取出编辑过稿 brief（默认 polish-depolish）。Agent 按 brief 改写正文后调用 edit_stage；改完须用户选 A/B/C，禁止自称已验收。技能：docs/skills/web-novel-master-optimizer.md",
      properties: {
        work: WORK_OPT,
        working_dir: WORKING_DIR,
        mode: S("润色模式，默认 polish-depolish；也可 polish-rhythm / condense / expand / style / literary / proofread"),
        candidate: S("可选：写手候选 id，回执带上源候选便于 edit_stage"),
        should_land: S("可选：本场应落纸一行正向（打碎僵硬）"),
        situation: S("可选：本章处境/冲突摘要"),
      },
      required: [],
      async execute(args, exec) {
        const cfg = getPortConfig();
        const mode = EditPort.normalizeMode(
          asString(args, "mode") ?? cfg.defaultEditMode,
        );
        const candidateId = asString(args, "candidate");
        let parentHint = "";
        if (candidateId) {
          const { dir } = await openWork(exec, args);
          const cand = await readCandidate(dir, candidateId);
          parentHint = `\n源写手候选：${cand.id}（章 ${cand.chapterId}，约 ${countWords(cand.body)} 字）\n改写后：zhizhang_candidate_edit_stage(parent=${cand.id}, content=…, mode=${mode})`;
        }
        const brief = EditPort.formatEditBrief({
          mode,
          shouldLandLine: asString(args, "should_land"),
          situation: asString(args, "situation"),
        });
        return [
          brief,
          parentHint,
          "",
          `下一步：${Scheduler.nextHint("style_lint")}`,
        ]
          .filter(Boolean)
          .join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_candidate_edit_stage",
      description:
        "【默认链·可选编辑】将编辑后正文暂存为新候选（editOf=写手候选；不写正式章）。随后须用户选 A/B/C；未表态按 B。禁止本工具内 accept。",
      properties: {
        work: WORK_OPT,
        working_dir: WORKING_DIR,
        parent: S("写手候选 id（被编辑的源候选）"),
        content: S("编辑后全文"),
        mode: S("润色模式，默认 polish-depolish"),
        note: S("可选说明"),
      },
      required: ["parent", "content"],
      async execute(args, exec) {
        const parentId = asString(args, "parent", { required: true })!;
        const content = asString(args, "content", { required: true, trim: false })!;
        if (!content.trim()) fail("content 不能为空");
        const cfg = getPortConfig();
        const mode = EditPort.normalizeMode(
          asString(args, "mode") ?? cfg.defaultEditMode,
        );
        const { dir } = await openWork(exec, args);
        const parent = await readCandidate(dir, parentId);
        if (parent.acceptedAt) {
          fail(
            `源候选 ${parentId} 已采纳，无法再挂编辑。请重新 stage 写手稿后再编辑。`,
            "edit_parent_accepted",
          );
        }
        const cand = await stageCandidate(dir, {
          chapterId: parent.chapterId,
          body: content,
          note: asString(args, "note") ?? `edit of ${parentId} · ${mode}`,
          source: "edit",
          editOf: parentId,
          editMode: mode,
        });
        const soft = auditHumanFeel(cand.body);
        const softHits = soft.hits.map((h) => ({ code: h.code, text: h.text }));
        return [
          ...EditPort.afterStageLines({
            editCandId: cand.id,
            parentCandId: parentId,
            mode,
            chapterId: cand.chapterId,
            softHits,
          }),
          `- 约 ${countWords(cand.body)} 字`,
          `下一步：${Scheduler.nextHint("candidate_edit_stage")}`,
        ].join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_candidate_edit_decide",
      description:
        "【默认链·可选编辑】用户对编辑候选显式选 A/B/C。A=一次确认应用编辑并 accept（须 confirm_accept_after_edit=true，且编辑候选已 lint）；B=仅确认候选、正式章不变；C=拒编辑。禁止静默 A。",
      properties: {
        work: WORK_OPT,
        working_dir: WORKING_DIR,
        candidate: S("编辑候选 id（须带 editOf）"),
        choice: E(["A", "B", "C"], "用户抉择"),
        confirm_accept_after_edit: B(
          "路径 A 必填 true：确认采纳本章编辑稿并验收为正式章",
        ),
        mode: E(["replace", "append"], "A 时写入模式，默认 replace"),
        force: B("A 且目标章 final 时须 true"),
        lint_pass_token: S("A 可选：显式 lintPassToken"),
        skip_brief: B("A 时跳过 brief 硬闸"),
        strict_lint: B("A 时 lint 命中硬拒"),
        require_payoff: B("A 时要求 payoff"),
        strict_human: B("A 时人味硬拒"),
        strict_novel: B("A 时书感硬拒"),
      },
      required: ["candidate", "choice"],
      async execute(args, exec) {
        const candidateId = asString(args, "candidate", { required: true })!;
        const choiceRaw = asString(args, "choice", { required: true })!;
        const choice = EditPort.resolveChoice(choiceRaw);
        if (!choice) fail("choice 须为 A / B / C", "edit_choice_invalid");

        const { dir } = await openWork(exec, args);
        const cand = await readCandidate(dir, candidateId);
        if (!cand.editOf) {
          fail(
            `候选 ${candidateId} 不是编辑产物（无 editOf）。请对 edit_stage 结果调用本工具。`,
            "edit_accept_not_an_edit",
          );
        }

        if (choice === "C") {
          return [
            ...EditPort.decideChoiceLines("C", {
              candId: candidateId,
              parentId: cand.editOf,
              mode: cand.editMode,
            }),
            `下一步：${Scheduler.nextHint("candidate_edit_decide_c")}`,
          ].join("\n");
        }

        if (choice === "B") {
          return [
            ...EditPort.decideChoiceLines("B", {
              candId: candidateId,
              parentId: cand.editOf,
              mode: cand.editMode,
            }),
            `下一步：${Scheduler.nextHint("candidate_edit_decide_b")}`,
          ].join("\n");
        }

        // A — require confirm; then full accept pipeline
        const confirmed = Boolean(args.confirm_accept_after_edit);
        if (!confirmed) {
          fail(
            "路径 A 须一次显式确认：传 confirm_accept_after_edit=true（确认：采纳本章编辑稿并验收为正式章）。禁止静默验收。",
            "edit_accept_confirm_required",
          );
        }

        const mode =
          (asString(args, "mode") as "replace" | "append" | undefined) ?? "replace";
        return runAcceptPipeline(args, exec, {
          candidateId,
          mode,
          force: Boolean(args.force),
          lintPassToken: asString(args, "lint_pass_token") ?? undefined,
          skipBrief: Boolean(args.skip_brief),
          strictLint: Boolean(args.strict_lint),
          requirePayoff: Boolean(args.require_payoff),
          strictHuman: Boolean(args.strict_human),
          strictNovel: Boolean(args.strict_novel),
          acceptAfterEdit: true,
          confirmAcceptAfterEdit: true,
        });
      },
    }),

    defineTool({
      name: "zhizhang_candidate_accept",
      description:
        "【默认链】采纳候选到章节草稿。硬闸：lintPassToken + 近期 chapter_brief。编辑路径 A 可传 accept_after_edit + confirm_accept_after_edit（一次确认=编辑+验收）；禁止只应用编辑却偷偷 accept。旁路：skip_brief / strict_* / require_payoff / force。",
      properties: {
        work: WORK_OPT,
        working_dir: WORKING_DIR,
        candidate: S("候选 id（cand-…）"),
        mode: E(["replace", "append"], "默认 replace"),
        force: B("目标章为 final 时必须为 true 才允许覆盖（采纳后降为 drafted）"),
        lint_pass_token: S("可选：zhizhang_style_lint 返回的 lintPassToken；省略则校验候选上已记录的 token"),
        skip_brief: B("跳过近期 chapter_brief 硬闸（作者/测试用；默认 false）"),
        strict_lint: B("若 lintHitCount>0 则硬拒（默认 false：仅警告 lint_hits_present）"),
        require_payoff: B("【旁路】无近期 payoff_audit 或 ok=false 则硬拒（默认 false，不要求先跑 audit）"),
        strict_human: B("若人味软雷达命中则硬拒（默认 false：仅警告 human_feel_hits）"),
        strict_novel: B("若书感软雷达命中则硬拒（默认 false：仅警告 novel_sense_hits；与人味闸默认分轨）"),
        accept_after_edit: B("路径 A：声明本候选为编辑稿并要连带验收（须同时 confirm_accept_after_edit）"),
        confirm_accept_after_edit: B(
          "路径 A 一次确认：采纳本章编辑稿并验收为正式章（无此旗标不得当 A）",
        ),
      },
      required: ["candidate"],
      async execute(args, exec) {
        const candidateId = asString(args, "candidate", { required: true })!;
        const mode =
          (asString(args, "mode") as "replace" | "append" | undefined) ?? "replace";
        return runAcceptPipeline(args, exec, {
          candidateId,
          mode,
          force: Boolean(args.force),
          lintPassToken: asString(args, "lint_pass_token") ?? undefined,
          skipBrief: Boolean(args.skip_brief),
          strictLint: Boolean(args.strict_lint),
          requirePayoff: Boolean(args.require_payoff),
          strictHuman: Boolean(args.strict_human),
          strictNovel: Boolean(args.strict_novel),
          acceptAfterEdit: Boolean(args.accept_after_edit),
          confirmAcceptAfterEdit: Boolean(args.confirm_accept_after_edit),
        });
      },
    }),
  ];
}
