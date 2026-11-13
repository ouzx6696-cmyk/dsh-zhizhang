import { assertNoPendingCard } from "../../storage/card-journal.js";
import { withResourceLock } from "../../storage/process-lock.js";

import { LibraryPort } from "../../ports/index.js";
import { readAnalysisBundle } from "../../ports/analysis/meta.js";

import {
  buildPlan,
  estimatePlan,
  planLabel,
  writePlan,
  readPlan,
  makeConfirmToken,
  writePendingConfirm,
  assertFullConsent,
  planProgress,
  PLAN_RATIO_DEFAULT,
  PLAN_SMALL_BOOK_CHARS,
  PLAN_BATCH_DEFAULT,
  PLAN_BATCH_MIN,
  PLAN_BATCH_MAX,
} from "../../ports/analysis/plan.js";

import { AUTO_SAMPLE_HEAD, AUTO_SAMPLE_RATIO, AUTO_SAMPLE_TAIL } from "../../domain/workflow.js";
import { asString, fail } from "../context.js";
import { S, B, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryPlan = defineTool({
  name: "fanqie_library_plan",
  description: `【闭环·库 2/9 抽样计划】Auto 默认按字数 ${Math.round(AUTO_SAMPLE_RATIO * 100)}% 分层抽样（前 ${AUTO_SAMPLE_HEAD} 章 + 后 ${AUTO_SAMPLE_TAIL} 章 + 等距）；Full 全量须先看成本回执，再由作者明确同意（confirm_full + confirm_token）。写 analyses/<id>/plan.json + plan.md。`,
  properties: {
    source: S("sourceId（library_import 返回）"),
    mode: {
      type: "string",
      enum: ["auto", "full"],
      description: `auto=${Math.round(AUTO_SAMPLE_RATIO * 100)}% 分层（默认）；full=全量（须作者明确同意）`,
    },
    ratio: { type: "number", description: "Auto 比例（默认 0.1，范围 0.05–1）" },
    batch_chars: { type: "integer", description: "每批字数上限（默认 30000，范围 4000–100000）" },
    confirm_full: B("Full 专用：作者明确同意后才传 true"),
    confirm_token: S("Full 专用：library_plan(mode=full) 回执里的 confirm_token"),
    reset: B("已有计划时重做（覆盖 plan.json）"),
    note: S("Full 同意备注（作者原话/时间）"),
    working_dir: WORKING_DIR,
  },
  required: ["source"],
  async execute(args, exec) {
    const sourceId = asString(args, "source", { required: true });
    const paths = await openLibrary(exec, args, true);
    return withResourceLock(paths.library, async () => {
      await assertNoPendingCard(paths.library);
      const mode = asString(args, "mode") || "auto";
      if (mode !== "auto" && mode !== "full")
        fail(`mode 只支持 auto | full（收到 ${mode}）`, "bad_args");
      const ratio = typeof args.ratio === "number" ? args.ratio : PLAN_RATIO_DEFAULT;
      // batch_chars 必须是有穷数：Number.NaN 也能通过 typeof === "number"，
      // 夹紧后会得到 NaN，分批比较恒为 false（全书挤成一批）。
      const rawBatch = Number.isFinite(args.batch_chars)
        ? Number(args.batch_chars)
        : PLAN_BATCH_DEFAULT;
      const batchChars = Math.max(PLAN_BATCH_MIN, Math.min(PLAN_BATCH_MAX, rawBatch));
      // Keep the current plan until a replacement has actually been confirmed and saved.
      const existing = await readPlan(paths, sourceId);
      if (existing && args.reset !== true && !(args.confirm_full === true)) {
        const prog = planProgress(existing, (await readAnalysisBundle(paths, sourceId)).chapters);
        return [
          "已有计划：" + planLabel(existing),
          "- 进度：事实 " +
            prog.done +
            "/" +
            prog.total +
            " 章 · 游标 " +
            prog.cursor +
            "/" +
            prog.batches,
          "- 计划文件：library/analyses/" + sourceId + "/plan.md",
          "要重做或切换档位（Auto↔Full）传 reset=true（会覆盖 plan.json，不删已交事实）。",
          prog.nextBatch
            ? "下一步：library_dissect_brief(source, batch=" + prog.cursor + ")"
            : "计划内章节均已有事实记录；请核对阅读情况后再 structure_stage 聚合。",
        ].join("\n");
      }
      const src = await LibraryPort.getSourceIndexed(paths, sourceId);
      const idx = src.index;
      const plan = buildPlan({
        sourceId,
        title: src.meta?.title ?? "",
        index: idx,
        mode,
        ratio,
        batchChars,
      });
      // 小书的既有全读规则保留；其他 Auto 计划若实际覆盖全书，走 Full 确认流程。
      if (
        plan.mode === "auto" &&
        plan.planChapters === plan.totalChapters &&
        plan.totalChars >= PLAN_SMALL_BOOK_CHARS
      ) {
        plan.mode = "full";
        plan.ratio = 1;
      }
      const est = estimatePlan(plan);
      if (plan.mode === "full" && args.confirm_full !== true) {
        const token = makeConfirmToken();
        await writePendingConfirm(paths, sourceId, token, est, {
          batchChars,
          totalChapters: plan.totalChapters,
          planChapters: est.chapters,
        });
        return [
          "## Full 成本回执（尚未写入计划）",
          "- 全书：" + plan.totalChapters + " 章 / " + plan.totalChars + " 字",
          "- 全量：" + est.chapters + " 章 / " + est.chars + " 字",
          "- 分批：" + est.batches + " 批（每批 ≤ " + batchChars + " 字）",
          "- 估算：约 " + est.tokens + " tokens · 顺序约 " + est.hours + " 小时",
          "- confirm_token：" + token + "（30 分钟有效）",
          "",
          "Full 须作者明确同意：请作者回复“确认全量”，再由 Agent 调用",
          'library_plan(source="' +
            sourceId +
            '", mode="full", confirm_full=true, confirm_token="' +
            token +
            '", note="作者原话…")',
          "已保存临时确认凭据；未确认不会替换现有计划或开始全量阅读。",
        ].join("\n");
      }
      if (plan.mode === "full") {
        await assertFullConsent(paths, sourceId, asString(args, "confirm_token"), {
          batchChars,
          totalChapters: plan.totalChapters,
          planChapters: est.chapters,
        });
        plan.consent = {
          at: new Date().toISOString(),
          note: asString(args, "note") || "作者明确要求全量",
        };
      }
      await writePlan(paths, plan, {
        clearConfirm: plan.mode === "full",
        confirmToken: asString(args, "confirm_token"),
      });
      const lines = [
        "已生成抽样计划：" + planLabel(plan),
        "- 全书：" + plan.totalChapters + " 章 / " + plan.totalChars + " 字",
        "- 计划：" +
          plan.planChapters +
          " 章 / " +
          plan.planChars +
          " 字（" +
          Math.round((plan.planChars / plan.totalChars) * 100) +
          "%）",
        "- 分批：" + est.batches + " 批（每批 ≤ " + batchChars + " 字）",
        "- 估算：约 " + est.tokens + " tokens · 顺序约 " + est.hours + " 小时",
        "- 首批：第 " + (plan.batches[0]?.chapters.join("、") ?? "—") + " 章",
        "- 计划文件：library/analyses/" + sourceId + "/plan.md",
        "",
        "下一步 3/9：fanqie_library_dissect_brief(source, batch=0) 取第 0 批；一批一提交，不要跨批跳读。",
      ];
      if (plan.mode === "auto")
        lines.push(
          "Auto 是抽样：报告里的全书结论会标「抽样观察」；要全书骨架请由作者明确要求 Full。",
        );
      return lines.join("\n");
    });
  },
});
