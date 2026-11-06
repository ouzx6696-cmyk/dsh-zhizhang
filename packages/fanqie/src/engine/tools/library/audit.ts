import { LibraryPort } from "../../ports/index.js";
import { readAnalysisBundle } from "../../ports/analysis/meta.js";
import { readSurvey } from "../../ports/analysis/survey.js";
import { computeCoverage } from "../../domain/coverage.js";
import { WHITE_DESC_HARD_RE } from "../../ports/analysis/facts.js";
import { planLabel, readPlan } from "../../ports/analysis/plan.js";

import { asString } from "../context.js";
import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryAudit = defineTool({
  name: "fanqie_library_audit",
  description:
    "【闭环·库 8/9 机械面审计】审计已入库卡：证据引文能否在原文核对、正文「声称原文」的引文能否回溯、证据章号是否对得上、readingRange 是否占位、mind 是否疑似设定复述。只诊断，不改卡；机械面通过≠卡能用，判断面须真读。",
  properties: {
    card: S("可选：只审计一张卡（cardId）"),
    source: S("可选：只审计一本书的卡（sourceId）"),
    axis: S("可选：craft | mind"),
    working_dir: WORKING_DIR,
  },
  required: [],
  async execute(args, exec) {
    const paths = await openLibrary(exec, args, false);
    const axisRaw = asString(args, "axis");
    const axis = axisRaw === "craft" ? "craft" : axisRaw === "mind" ? "mind" : undefined;
    const rows = await LibraryPort.auditCards(paths, {
      cardId: asString(args, "card"),
      sourceId: asString(args, "source"),
      axis,
    });
    const cardArg = asString(args, "card");
    if (!rows.length)
      return cardArg
        ? `找不到卡：${cardArg}（须为已采纳卡 id）`
        : "审计范围为空：没有匹配的已采纳卡。";
    const analysisLines = [];
    const srcId = asString(args, "source");
    if (srcId) {
      const bundle = await readAnalysisBundle(paths, srcId);
      if (bundle.meta) {
        const qTotal = rows.reduce((n: number, r) => n + (r.evidenceQuotes || 0), 0);
        const qOk = rows.reduce((n: number, r) => n + (r.evidenceVerified || 0), 0);
        const plan = await readPlan(paths, srcId);
        const survey = await readSurvey(paths, srcId);
        const planned = plan ? new Set(plan.chapters.map((c) => Number(c.n))) : null;
        const scopedFacts = planned
          ? bundle.chapters.filter((f) => planned.has(Number(f.n)))
          : bundle.chapters;
        const coverage = computeCoverage(
          bundle.meta,
          scopedFacts,
          rows,
          { total: qTotal, ok: qOk },
          {
            survey,
            plots: bundle.plots,
            rhythms: bundle.rhythms,
            characters: bundle.characters,
            autoCap: plan?.mode === "auto" && plan.planChapters < (bundle.meta?.totalChapters ?? 0),
          },
        );
        let white = 0;
        for (const f of bundle.chapters) {
          for (const ev of f.events ?? []) {
            if (WHITE_DESC_HARD_RE.test(String(ev.desc ?? ""))) white += 1;
          }
        }
        analysisLines.push("", "## 分析层（事实/聚合）");
        analysisLines.push(
          `- 事实：${bundle.chapters.length} 章 · 剧情条 ${bundle.plots.length} · 人物 ${bundle.characters.length}`,
        );
        analysisLines.push(
          `- 白描违规：${white} 条${white ? "（desc 含心理/评价词，需改写为动作）" : ""}`,
        );
        analysisLines.push(
          `- 覆盖：${coverage.facts}/${coverage.scope} · 材料完备度 ${coverage.confidence}（机械指标，非阅读或质量证明）${coverage.needsReview ? " · needs_review" : ""}`,
        );
        if (plan)
          analysisLines.push(`- 计划：${planLabel(plan)} · 抽样表见 analyses/${srcId}/plan.md`);
      }
    }
    const hardBad = rows.filter(
      (r) =>
        r.unverifiable.length || r.chapterOk === false || (r.bodyUnverifiable?.length ?? 0) > 0,
    );
    const soft = rows.filter((r) => r.warnings.length && !hardBad.includes(r));
    const evOk = rows.filter((r) => r.evidenceQuotes > 0 && r.unverifiable.length === 0).length;
    const bodyCards = rows.filter((r) => (r.bodyQuotes ?? 0) > 0);
    const bodyOk = bodyCards.filter((r) => (r.bodyUnverifiable?.length ?? 0) === 0).length;
    const bodyTotal = bodyCards.reduce((n: number, r) => n + (r.bodyQuotes ?? 0), 0);
    const skippedTotal = rows.reduce((a, r) => a + (r.skippedShort?.length ?? 0), 0);
    const lines = [
      `拆书库审计 · ${rows.length} 张卡（机械面）`,
      `- 证据全部可回溯：${evOk}/${rows.length}`,
      bodyCards.length
        ? `- 正文引文可回溯：${bodyOk}/${bodyCards.length} 张（共 ${bodyTotal} 条声称引文）`
        : "- 正文引文：未发现声称原文的正文引文（示例引语不核对）",
      `- 硬问题：${hardBad.length} · 软警告：${soft.length}`,
      ...(skippedTotal
        ? [
            `- 过短未核对：${skippedTotal} 条（${rows.filter((r) => r.skippedShort?.length).length} 张卡）`,
          ]
        : []),
      ...analysisLines,
    ];
    lines.push(
      "",
      "判断面（脚本核不了）：机制成不成立 / rebuild 能不能迁移 / mind 是否设定复述——必须真读原文按五条判。",
    );
    if (!hardBad.length && !soft.length) {
      lines.push("", "机械面通过 ≠ 卡能用。请按每张卡的「检验方法」读一遍原文。");
      return lines.join("\n");
    }
    for (const r of hardBad) {
      lines.push("", `· 硬问题：${r.title}（${r.id}）· axis=${r.axis}`);
      if (r.evidenceQuotes)
        lines.push(
          `  证据 ${r.evidenceVerified}/${r.evidenceQuotes} 可核对` +
            (r.skippedShort?.length ? `（过短跳过 ${r.skippedShort.length} 条）` : ""),
        );
      for (const q of r.unverifiable.slice(0, 3)) lines.push(`  - 未命中：「${q.slice(0, 60)}」`);
      if ((r.bodyQuotes ?? 0) > 0)
        lines.push(
          `  正文引文 ${r.bodyVerified}/${r.bodyQuotes} 可核对` +
            ((r.bodySkipped ?? 0) > 0 ? `（另 ${r.bodySkipped} 条为示例引语，不核对）` : ""),
        );
      for (const q of (r.bodyUnverifiable ?? []).slice(0, 3))
        lines.push(`  - 正文未命中：「${q.slice(0, 60)}」`);
      for (const w of r.warnings) lines.push(`  - ${w}`);
    }
    for (const r of soft) {
      lines.push("", `· 软警告：${r.title}（${r.id}）· axis=${r.axis}`);
      for (const w of r.warnings) lines.push(`  - ${w}`);
    }
    lines.push("", "机械面硬项见上；软警告不阻断，但要在判断面解释清楚。");
    return lines.join("\n");
  },
});
