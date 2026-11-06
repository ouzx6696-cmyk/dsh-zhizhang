/**
 * 拆书简报文本：批次模式（逐章原文 + 事实提交模板）与整书摘录模式。
 * 读取书源、持库锁由 LibraryPort.dissectBrief 负责；这里只决定取哪几章、怎么排版。
 */
import { dissectBatchHeader, dissectBriefHeader } from "../../method-templates.js";
import { MethodRegistry } from "../methods.js";
import {
  chapterIndex,
  chapterText,
  chapterTitle,
  nearestChapter,
  totalChapters,
} from "../analysis/chapters.js";
import { ensureAnalysis, writeAnalysisMeta, readAnalysisBundle } from "../analysis/meta.js";
import type { StoragePaths } from "../../types.js";
import type { SourceMeta } from "./types.js";

type ChapterIndex = ReturnType<typeof chapterIndex>;
interface DissectOptions {
  mode?: string;
  from?: number;
  count?: number;
  maxChars?: number;
  includeRecommend?: boolean;
}
interface BookSource {
  meta: SourceMeta;
  text: string;
  index: ChapterIndex;
}

function pickChapters(mode: string, idx: ChapterIndex, opts: DissectOptions) {
  if (mode === "opening") return [1, 2, 3].filter((n) => idx.some((c) => c.n === n));
  if (mode === "sample")
    return [
      ...new Set(
        [0.1, 0.3, 0.6, 0.85]
          .map((r) => Number(nearestChapter(idx, r)))
          .filter((n) => Number.isFinite(n) && n > 0),
      ),
    ];
  const from = Math.max(1, Math.floor(Number(opts.from ?? 1) || 1));
  const count = Math.max(1, Math.min(5, Math.floor(Number(opts.count ?? 3) || 3)));
  return Array.from({ length: count }, (_, i) => from + i);
}

/**
 * 无 plan 的 mode=full 只是「从 from 起 3-5 章」，绝不是全量阅读——
 * 若在这里写 scope.mode="full"，报告会去掉「抽样观察」标记、覆盖率可到 1.0，
 * 属可信度造假。全量 scope 只能由 library_plan(mode=full, 经作者同意) 产生。
 */
async function recordBatchScope(
  paths: StoragePaths,
  sourceId: string,
  mode: string,
  picked: number[],
) {
  const prevScope = (await readAnalysisBundle(paths, sourceId)).meta?.scope ?? {
    mode: "none",
    chapters: 0,
  };
  const scopeMode = mode === "opening" ? "opening" : mode === "sample" ? "sample" : "chapters";
  const planned = mode === "sample" ? picked.length : picked.length ? Math.max(...picked) : 0;
  await writeAnalysisMeta(paths, sourceId, {
    scope: { mode: scopeMode, chapters: Math.max(planned, Number(prevScope.chapters ?? 0)) },
  });
}

function sliceBatch(source: BookSource, picked: number[], maxChars: number | undefined) {
  const budget = Math.max(4000, Math.min(Number(maxChars ?? 15000), 30000));
  const batch = [];
  let used = 0;
  for (const n of picked) {
    const body = chapterText(source.text, source.index, n);
    if (!body) continue;
    const room = budget - used;
    if (room <= 800) break;
    const chunk =
      body.length <= room
        ? body
        : body.slice(0, room) + `\n…（本章截断，完整见 sources/${source.meta.excerptPath}）`;
    batch.push({ n, title: chapterTitle(source.index, n), text: chunk });
    used += chunk.length;
  }
  return batch;
}

const FACT_SUBMISSION_EXAMPLE = {
  n: 1,
  title: "…",
  events: [{ loc: "P1-P3", desc: "谁做了什么，结果怎样", quote: "原文片段" }],
  functions: ["入局"],
  hook: { type: "悬念", text: "章末钩子", strength: "强" },
  value: { situation: "…", relation: "…", cognition: "…", emotion: "…" },
  unknowns: ["原文没写的动机"],
  readingLevel: "正文已读",
};

/** 批次模式：记 scope、取章、拼原文与事实提交模板。 */
export async function dissectBatchText(
  paths: StoragePaths,
  source: BookSource,
  mode: string,
  opts: DissectOptions,
) {
  const { meta, text, index } = source;
  await ensureAnalysis(paths, meta.id, text);
  const picked = pickChapters(mode, index, opts);
  await recordBatchScope(paths, meta.id, mode, picked);
  const batch = sliceBatch(source, picked, opts.maxChars);
  const facts = (await readAnalysisBundle(paths, meta.id)).chapters;
  const lines = dissectBatchHeader(meta, totalChapters(index), facts.length, batch);
  if (mode === "full") {
    lines.push(
      "- 注意：无 plan 的 mode=full 只取 from 起数章，不是全量；全量须 library_plan(mode=full)（作者同意后）。本批按 chapters 记 scope。",
    );
  }
  lines.push(
    "",
    "【纪律】只记白描：谁做了什么、结果怎样；原文没写的动机/身份/后果写进 unknowns，禁止补。",
    "心理/评价词只提示回看：区分人物明确说过的话与分析者推断，不能单凭词表拒绝事实。",
    "",
    "## 每章提交格式（fanqie_library_facts_stage；阅读程度须如实申报，未声明可省略）",
    "```json",
    JSON.stringify({ source: meta.id, facts: FACT_SUBMISSION_EXAMPLE }, null, 2),
    "```",
    "",
    "## 本批原文",
  );
  for (const b of batch) {
    lines.push(`\n### 第${b.n}章 ${b.title}`);
    lines.push("<<<SOURCE");
    lines.push(b.text);
    lines.push("SOURCE>>>");
  }
  return lines.join("\n");
}

/** 整书模式：方法说明 + 截断摘录。 */
export function dissectBriefText(meta: SourceMeta, text: string, opts: DissectOptions) {
  const maxChars = Math.max(800, Math.min(opts.maxChars ?? 12000, 80000));
  const excerpt =
    text.length <= maxChars
      ? text
      : text.slice(0, maxChars) +
        `\n\n…（已截断，原文共 ${text.length} 字；完整在 sources/${meta.excerptPath}）`;
  const analyze = MethodRegistry.get("analyze");
  const recommend = opts.includeRecommend !== false ? MethodRegistry.get("recommend") : undefined;
  const lines = dissectBriefHeader(meta);
  for (const method of [analyze, recommend]) {
    if (!method) continue;
    lines.push(MethodRegistry.formatForAgent(method));
    lines.push("");
  }
  lines.push("## 原文摘录");
  lines.push("<<<SOURCE");
  lines.push(excerpt);
  lines.push("SOURCE>>>");
  lines.push("");
  lines.push(
    "完成后：为每张卡填 axis +（craft: humanFeel+bookCraft | mind: mind）+ mechanisms + body，再 card_stage → card_accept。",
  );
  return lines.join("\n");
}
