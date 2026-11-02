import { assertNoPendingCard } from "../../storage/card-journal.js";
import { withResourceLock } from "../../storage/process-lock.js";

import { NovelError } from "../../errors.js";

import { LibraryPort } from "../../ports/index.js";
import { readAnalysisBundle } from "../../ports/analysis/meta.js";

import { planLabel, readPlan, planProgress } from "../../ports/analysis/plan.js";
import { chapterText, chapterTitle } from "../../ports/analysis/chapters.js";

import { asString, fail } from "../context.js";
import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryDissectBrief = defineTool({
  name: "fanqie_library_dissect_brief",
  description:
    "【闭环·库 3/9 取批次】有 plan 时按 batch 取本批原文；无 plan 时按 from/count 取。不代写。下一步 4/9：facts_stage 逐章白描。",
  properties: {
    source: S("sourceId（library_import 返回）"),
    mode: {
      type: "string",
      enum: ["opening", "chapters", "sample", "full"],
      description:
        "批次模式：opening 开篇3章 / chapters 指定起章 / sample 10-30-60-85% / full 从 from 起 3 章",
    },
    from: { type: "integer", description: "起始章（mode=chapters/full）" },
    count: { type: "integer", description: "本批章数（默认 3，最多 5；无 plan 时用）" },
    batch: { type: "integer", description: "有 plan 时：批号（从 0 起）" },
    max_chars: { type: "integer", description: "摘录/批次上限（默认 12000/15000）" },
    working_dir: WORKING_DIR,
  },
  required: ["source"],
  async execute(args, exec) {
    const sourceId = asString(args, "source", { required: true });
    const paths = await openLibrary(exec, args, true);
    return withResourceLock(paths.library, async () => {
      await assertNoPendingCard(paths.library);
      const plan = await readPlan(paths, sourceId);
      const batchNo = typeof args.batch === "number" ? args.batch : undefined;
      if (plan && batchNo !== undefined) {
        const b = plan.batches[batchNo];
        if (!b) fail(`批号越界：0–${plan.batches.length - 1}（${planLabel(plan)}）`, "bad_args");
        const src = await LibraryPort.getSourceIndexed(paths, sourceId);
        const idx = src.index;
        const requestedBudget =
          typeof args.max_chars === "number" && Number.isFinite(args.max_chars)
            ? Math.max(1, Math.floor(args.max_chars))
            : plan.batchChars;
        const budget = Math.min(requestedBudget, plan.batchChars);
        const facts = (await readAnalysisBundle(paths, sourceId)).chapters;
        const done = new Set(facts.map((f) => Number(f.n)));
        const unfinished = b.chapters.filter((n: number) => !done.has(n));
        // 重取已完成批次仍可复读；部分完成时优先返回未提交的章节，避免预算较小时反复卡在第一章。
        const requested = unfinished.length ? unfinished : b.chapters;
        const parts: string[] = [];
        const delivered: number[] = [];
        let used = 0;
        for (const n of requested) {
          const t = chapterText(src.text, idx, n);
          if (!t)
            throw new NovelError(
              "bad_source",
              `计划中的第 ${n} 章无法读取；请核对书源和章节索引。`,
            );
          if (used + t.length > budget && parts.length) break;
          parts.push("### 第" + n + "章 " + chapterTitle(idx, n), "<<<SOURCE", t, ">>>");
          delivered.push(n);
          used += t.length;
        }
        const remaining = requested.filter((n: number) => !delivered.includes(n));
        const prog = planProgress(plan, facts);
        return [
          "# 拆书批次 · " + (plan.title || sourceId),
          "- " + planLabel(plan),
          "- 本批 " +
            (batchNo + 1) +
            "/" +
            plan.batches.length +
            " · 计划章节：" +
            b.chapters.join("、") +
            " · 约 " +
            b.chars +
            " 字",
          "- 本次实际提供原文：" +
            (delivered.join("、") || "无") +
            " · " +
            used +
            " 字（提供原文不等于已读或已深读）",
          ...(remaining.length
            ? ["- 本批尚未提供：" + remaining.join("、") + "；提交本次事实后可再次取同一批。"]
            : []),
          ...(used > budget ? ["- 单章超过本次预算，已完整提供该章以免截断。"] : []),
          "- 进度：事实 " +
            prog.done +
            "/" +
            prog.total +
            " 章 · 游标 " +
            prog.cursor +
            "/" +
            prog.batches,
          "",
          "【纪律】只记白描：谁做了什么、结果怎样；原文没写的动机/身份/后果写进 unknowns，禁止补。",
          "【禁】desc 里出现 心里/觉得/认为/希望/害怕/后悔/其实/精彩/感人/震撼 等心理评价词会被拒。",
          "",
          ...parts,
          "",
          "下一步 4/9：阅读本次提供的原文，再用 fanqie_library_facts_stage 提交已读章节事实；不要替未提供章节补写。",
        ].join("\n");
      }
      if (plan && batchNo === undefined) {
        const prog = planProgress(plan, (await readAnalysisBundle(paths, sourceId)).chapters);
        // 有计划时 mode=full 不生效（全量 scope 只来自 library_plan 的作者同意）——
        // 但不能静默无视：明确告知 Agent 升级全量的正路，避免它以为在读全量。
        const fullAsk = asString(args, "mode") === "full";
        return [
          "已有计划：" + planLabel(plan),
          "- 进度：事实 " +
            prog.done +
            "/" +
            prog.total +
            " 章 · 游标 " +
            prog.cursor +
            "/" +
            prog.batches,
          "- 下一批：library_dissect_brief(source, batch=" + prog.cursor + ")",
          prog.nextBatch ? "- 该批章号：" + prog.nextBatch.chapters.join("、") : "- 计划已全部取完",
          ...(fullAsk
            ? [
                '- 注意：当前计划非 Full，mode=full 不会在这里生效；要全量须 library_plan(source, mode="full", reset=true) 生成成本回执并取得作者同意。',
              ]
            : []),
        ].join("\n");
      }
      const maxChars = typeof args.max_chars === "number" ? args.max_chars : undefined;
      const mode = asString(args, "mode");
      const from = typeof args.from === "number" ? args.from : undefined;
      const count = typeof args.count === "number" ? args.count : undefined;
      const brief = await LibraryPort.dissectBrief(paths, sourceId, {
        maxChars,
        mode,
        from,
        count,
      });
      const next = mode
        ? "下一步 4/9：按批调用 fanqie_library_facts_stage（每章一条）。白描只写动作与结果；没写的动机进 unknowns。"
        : "下一步 4/9：fanqie_library_facts_stage。逐章白描（谁做了什么、结果）；没写的动机进 unknowns，禁补。";
      const out = [brief, "", next];
      return out.join(String.fromCharCode(10));
    });
  },
});
