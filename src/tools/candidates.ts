/** Writing pillar — candidate stage / accept. */
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
} from "../lib/store.js";
import {
  AcceptPolicy,
  FoundationPort,
  firstDenyCode,
  firstDenyText,
} from "../lib/ports/index.js";
import { asString, fail, openWork } from "./context.js";
import { B, E, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool, type ToolDef } from "./types.js";

export function candidatesTools(): ToolDef[] {
  return [
    defineTool({
      name: "zhizhang_candidate_stage",
      description:
        "【默认链】暂存候选到 candidates/（不写 chapters/）。下一步：style_lint(candidate) → candidate_accept。",
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
        ].join("\n");
      },
    }),

    defineTool({
      name: "zhizhang_candidate_accept",
      description:
        "【默认链】采纳候选到章节草稿。硬闸：lintPassToken + 近期 chapter_brief。内嵌软传感；命中默认警告。旁路硬拒：strict_* / require_payoff；跳过 brief：skip_brief；final 改稿：force。采纳后短追加 happened。不代表定稿。",
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
      },
      required: ["candidate"],
      async execute(args, exec) {
        const candidateId = asString(args, "candidate", { required: true })!;
        const mode = (asString(args, "mode") as "replace" | "append" | undefined) ?? "replace";
        const skipBrief = Boolean(args.skip_brief);
        const strictLint = Boolean(args.strict_lint);
        const requirePayoff = Boolean(args.require_payoff);
        const strictHuman = Boolean(args.strict_human);
        const strictNovel = Boolean(args.strict_novel);
        const { dir } = await openWork(exec, args);
        const candMeta = await readCandidate(dir, candidateId);

        const brief = await getRecentBrief(dir, candMeta.chapterId);
        const payoff = await getRecentPayoffAudit(dir, candMeta.chapterId);
        let prevBody: string | null = null;
        try {
          const chapters = await listChapters(dir);
          const idx = chapters.findIndex((c) => c.id === candMeta.chapterId);
          if (idx > 0) {
            const prev = await readChapter(dir, chapters[idx - 1]!.id);
            prevBody = prev.body || null;
          } else if (idx < 0 && chapters.length > 0) {
            // New chapter id not yet in meta: use last chapter by position as prev
            const last = chapters[chapters.length - 1]!;
            if (last.id !== candMeta.chapterId) {
              const prev = await readChapter(dir, last.id);
              prevBody = prev.body || null;
            }
          }
        } catch {
          prevBody = null;
        }
        const gate = AcceptPolicy.evaluate({
          candidate: candMeta,
          brief,
          payoff,
          skipBrief,
          strictLint,
          requirePayoff,
          strictHuman,
          strictNovel,
          prevBody,
        });
        if (!gate.ok) fail(firstDenyText(gate), firstDenyCode(gate));

        const saved = await acceptCandidate(dir, candidateId, mode, {
          force: Boolean(args.force),
          lintPassToken: asString(args, "lint_pass_token"),
        });

        // 0.10.0: happened from ending if aligned with body tail; else short body outcome
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
          `已采纳 ${candidateId} →「${saved.title}」（${saved.id}），${saved.wordCount} 字，状态 ${saved.status}。仍需作者审校/定稿。`,
          ...gate.receiptLines,
          ...happenedLines,
        ];
        return lines.join("\n");
      },
    }),
  ];
}
