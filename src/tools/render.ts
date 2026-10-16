import { readWorkMeta } from "../lib/store.js";
import { Scheduler, StyleLinterPort } from "../lib/ports/index.js";
import type { Outline } from "../lib/types.js";

export function clip(text: string, max: number): string {
  const t = (text ?? "").trim();
  if (!t) return "（空）";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}


/** Lean outline for chapter_brief: no beats list (beats stay on disk via outline_get). */
export function renderOutlineLean(o: Outline): string {
  const lines = [
    `- 目标字数：${o.targetWords}`,
    `- 处境透镜：${o.situationLens || "（空）"}`,
    `- 冲突：${o.conflict || "（空）"}`,
    `- 锁定：${o.locks || "（空）"}`,
    `- 落点 ending（纲末兑付 · 写进场面）：${o.ending || "（空）"}`,
  ];
  if (o.stateLens?.trim()) lines.push(`- 状态透镜：${o.stateLens.trim()}`);
  if (o.livedScene?.trim()) lines.push(`- 亲历：${clip(o.livedScene, 120)}`);
  return lines.join("\n");
}

export function renderOutline(o: Outline): string {
  const lines = [
    `- 视角：${o.pov || "（空）"}`,
    `- 目标字数：${o.targetWords}`,
    `- 处境透镜 situationLens：${o.situationLens || "（空）"}`,
    `- 亲历重心 livedScene：${o.livedScene || "（空）"}`,
    `- 状态透镜 stateLens：${o.stateLens || "（空）"}`,
    `- 锁定：${o.locks || "（空）"}`,
    `- 知情：${o.knowledge || "（空）"}`,
    `- 冲突：${o.conflict || "（空）"}`,
    `- 节拍：${o.beats || "（空）"}`,
    `- 落点：${o.ending || "（空）"}`,
    `- 概要：${o.synopsis || "（空）"}`,
  ];
  return lines.join("\n");
}

export function renderStatus(meta: Awaited<ReturnType<typeof readWorkMeta>>, dir: string): string {
  const total = meta.chapters.reduce((s, c) => s + c.wordCount, 0);
  const finalN = meta.chapters.filter((c) => c.status === "final").length;
  const lines = [
    `# 织章作品：${meta.title}`,
    `- key：${meta.key}`,
    `- 目录：${dir}`,
    `- 类型：${meta.genre || "（未设）"}`,
    `- 更新：${meta.updatedAt}`,
    `- 章节：${meta.chapters.length}（定稿 ${finalN}），约 ${total} 字`,
    "",
    "## 根基（节选）",
    `- 锁定：${clip(meta.foundation.locks, 80)}`,
    `- 已发生：${clip(meta.foundation.happened, 80)}`,
    `- 未结伏笔：${clip(meta.foundation.threads, 80)}`,
    "",
    "## 章节",
  ];
  for (const ch of [...meta.chapters].sort((a, b) => a.position - b.position)) {
    lines.push(`${ch.position}. [${ch.status}] ${ch.title}（${ch.id}，${ch.wordCount} 字）`);
  }
  lines.push(
    "",
    `下一步（默认）：${Scheduler.nextHint("work_status")}`,
  );
  return lines.join("\n");
}

export function formatLint(
  label: string,
  hits: ReturnType<typeof StyleLinterPort.lint>,
  summary: ReturnType<typeof StyleLinterPort.summarize>,
): string {
  return StyleLinterPort.format(label, hits, summary);
}
