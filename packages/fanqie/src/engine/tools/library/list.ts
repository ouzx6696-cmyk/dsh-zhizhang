import { inspectPendingCard, resumePendingCard } from "../../storage/card-journal.js";
import {
  hasPendingSource,
  inspectPendingSource,
  resumePendingSource,
} from "../../storage/source-journal.js";
import {
  hasPendingDiscard,
  inspectPendingDiscard,
  resumePendingDiscard,
} from "../../storage/discard-journal.js";
import {
  hasPendingAnalysis,
  inspectPendingAnalysis,
  resumePendingAnalysis,
} from "../../storage/analysis-journal.js";
import {
  hasPendingPlan,
  inspectPendingPlan,
  resumePendingPlan,
} from "../../storage/plan-journal.js";

import { LibraryPort } from "../../ports/index.js";
import { readAnalysisBundle, listAnalyses } from "../../ports/analysis/meta.js";

import { planLabel, readPlan, planProgress } from "../../ports/analysis/plan.js";

import { ensureStorage } from "../../storage/paths.js";
import { listLocalBooks } from "../../storage/projects.js";

import { asString, asStringArray, config, fail } from "../context.js";
import { S, E, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryList = defineTool({
  name: "fanqie_library_list",
  description: "【闭环·库·辅助】列出源与已采纳卡；可按书/轴过滤。主链见 product_map 工作流。",
  properties: {
    what: S("sources | cards | all（默认 all）"),
    source: S("按单本 sourceId 过滤卡"),
    source_ids: {
      type: "array",
      description: "按多本 sourceId 过滤卡",
      items: { type: "string" },
    },
    source_title: S("按书名/作者子串过滤卡"),
    axis: S("craft | mind"),
    recovery: E(["inspect", "resume"], "书源导入、拆书分析、卡采纳或删卡中断时检查或恢复原操作"),
    working_dir: WORKING_DIR,
  },
  required: [],
  async execute(args, exec) {
    const recovery = asString(args, "recovery");
    if (recovery) {
      if (recovery !== "inspect" && recovery !== "resume")
        fail("recovery 只支持 inspect 或 resume");
      const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
      if (await hasPendingSource(paths.library)) {
        if (recovery === "inspect") {
          const r = await inspectPendingSource(paths.library);
          return [
            `书源导入恢复记录：${r.id}`,
            `- 书源 ${r.sourceId} · ${r.createdAt}`,
            ...r.writes.map((w) => `- ${w.file}：${w.state}`),
            ...r.guards.map((g) => `- ${g.file}：${g.state}`),
            r.conflict
              ? "发现冲突，请保留文件并人工核对。"
              : "无文件冲突；确认原操作结束或原进程停止后可用 recovery=resume。",
          ].join("\n");
        }
        const r = await resumePendingSource(paths.library);
        return `已恢复书源 ${r.sourceId} 的导入；原文、元数据和索引已对齐，请勿重复导入。`;
      }
      if (await hasPendingDiscard(paths.library)) {
        if (recovery === "inspect") {
          const r = await inspectPendingDiscard(paths.library);
          return [
            `删卡恢复记录：${r.id}`,
            `- 卡 ${r.cardId} · ${r.createdAt}`,
            ...r.writes.map((w) => `- ${w.file}：${w.state}`),
            r.conflict
              ? "发现冲突，请保留文件并人工核对。"
              : "无文件冲突；确认原操作结束或原进程停止后可用 recovery=resume。",
          ].join("\n");
        }
        const r = await resumePendingDiscard(paths.library);
        return `已恢复卡 ${r.cardId} 的删除，索引与卡文件已对齐。`;
      }
      if (await hasPendingAnalysis(paths.library)) {
        if (recovery === "inspect") {
          const r = await inspectPendingAnalysis(paths.library);
          return [
            `拆书分析恢复记录：${r.id}`,
            `- 书源 ${r.sourceId} · ${r.dataFile} · ${r.createdAt}`,
            ...r.writes.map((w) => `- ${w.file}：${w.state}`),
            r.conflict
              ? "发现冲突，请保留文件并人工核对。"
              : "无文件冲突；确认原操作结束或原进程停止后可用 recovery=resume。",
          ].join("\n");
        }
        const r = await resumePendingAnalysis(paths.library);
        return `已恢复书源 ${r.sourceId} 的分析更新（${r.dataFile}），分析内容与进度元数据已对齐。`;
      }
      if (await hasPendingPlan(paths.library)) {
        if (recovery === "inspect") {
          const r = await inspectPendingPlan(paths.library);
          return [
            `拆书计划恢复记录：${r.id}`,
            `- 书源 ${r.sourceId} · ${r.createdAt}`,
            ...r.writes.map((w) => `- ${w.file}：${w.state}`),
            r.conflict
              ? "发现冲突，请保留文件并人工核对。"
              : "无文件冲突；确认原操作结束或原进程停止后可用 recovery=resume。",
          ].join("\n");
        }
        const r = await resumePendingPlan(paths.library);
        return `已恢复书源 ${r.sourceId} 的拆书计划与进度元数据。`;
      }
      if (recovery === "inspect") {
        const r = await inspectPendingCard(paths.library);
        return [
          `卡采纳恢复记录：${r.id}`,
          `- 候选 ${r.candidateId} → 卡 ${r.cardId} · ${r.createdAt}`,
          ...r.writes.map((w) => `- ${w.file}：${w.state}`),
          ...r.guards.map((g) => `- ${g.file}：${g.state}`),
          r.conflict
            ? "发现冲突；不会自动覆盖，请保留文件并人工核对。"
            : "无文件冲突；同一进程操作结束后或原进程停止后，可传 recovery=resume 完成原操作。",
        ].join("\n");
      }
      const r = await resumePendingCard(paths.library);
      return `已恢复原卡采纳：候选 ${r.candidateId} → ${r.cardId}。卡、索引和候选状态已对齐；请阅读卡片并人工判断其可迁移性。不要重复采纳。`;
    }
    const what = (asString(args, "what") ?? "all").toLowerCase();
    const paths = await openLibrary(exec, args, false);
    const sourceIds = asStringArray(args, "source_ids");
    const axisRaw = asString(args, "axis");
    const axis:import("../../ports/library/types.js").CardAxis|undefined = axisRaw === "craft" ? "craft" : axisRaw === "mind" ? "mind" : undefined;
    const filter = {
      status: "accepted",
      sourceId: asString(args, "source"),
      sourceIds,
      sourceTitle: asString(args, "source_title"),
      axis,
    };
    const lines = ["# 拆书库"];
    if (what === "sources" || what === "all") {
      const sources = await LibraryPort.listSources(paths);
      lines.push("## 来源");
      if (sources.length === 0) lines.push("（空）");
      else {
        for (const s of sources) {
          lines.push(`- ${s.title}${s.author ? ` · ${s.author}` : ""}（${s.id}）`);
        }
      }
    }
    if (what === "cards" || what === "all") {
      const cards = await LibraryPort.listCards(paths, filter);
      lines.push("## 已采纳卡");
      if (cards.length === 0) lines.push("（空）");
      else {
        for (const c of cards) {
          lines.push(
            `- ${c.title}（${c.id}）· axis=${c.axis ?? "?"} · tags=${c.tags?.join(",") || "—"} · src=${c.sourceId}`,
          );
        }
      }
    }
    const analyses = await listAnalyses(paths);
    if (analyses.length) {
      lines.push("## 拆书进度");
      for (const a of analyses) {
        const p = await readPlan(paths, a.sourceId);
        const prog = p
          ? planProgress(p, (await readAnalysisBundle(paths, a.sourceId)).chapters)
          : null;
        lines.push(
          `- ${a.sourceId} · stage=${a.stage} · 事实 ${a.facts}/${a.totalChapters} · 剧情条 ${a.plots}` +
            (p && prog ? ` · ${planLabel(p)} · 计划进度 ${prog.done}/${prog.total}` : ""),
        );
      }
    }
    if (paths.sourceRoot) {
      lines.push(`## 本地书源（${paths.sourceRoot}）`);
      const local = await listLocalBooks(paths.sourceRoot, { limit: 50 });
      if (local.length === 0) {
        lines.push("（目录里没有 .txt / .md 文件）");
      } else {
        const all = await LibraryPort.listSources(paths);
        const titles = new Set(all.map((x) => x.title));
        for (const b of local) {
          const kb = Math.max(1, Math.round(b.bytes / 1024));
          lines.push(`- ${b.name} · ${kb} KB · ${titles.has(b.title) ? "已导入" : "未导入"}`);
        }
        lines.push('导入：fanqie_library_import { title, file: "<文件名>" }');
      }
    }
    return lines.join("\n");
  },
});
