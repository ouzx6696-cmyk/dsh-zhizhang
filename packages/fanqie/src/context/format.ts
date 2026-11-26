import { estimateTokensRaw } from "@zhizhang/core/model";
import type { ContextBlock } from "@zhizhang/core/pipeline";

export type PreviousTextMode = { kind: "full"; maxChars: number } | { kind: "tail"; chars: number };

export interface BookPlanContext {
  title?: string;
  coreConflict?: string;
  currentVolume?: {
    volume: number;
    title: string;
    summary: string;
  };
}

export interface ReferenceCardContext {
  id: string;
  title: string;
  category: string;
  pattern: string;
  usage: string;
  scope?: "work" | "chapter";
  layer?: "book" | "arc" | "unit" | "chapter" | "scene" | "line";
  dimension?: "structure" | "character" | "rhythm" | "hook" | "prose" | "commercial";
  emotionArc?: string;
  steps?: string[];
  transfer?: string;
  mustNotCopy?: string[];
  failWhen?: string;
  bannedDiction?: string[];
}

export function formatReferenceCard(c: ReferenceCardContext): string {
  const tags = [c.layer, c.dimension, c.category].filter(Boolean).join("/");
  const lines = [`- [${tags}] ${c.title}：${c.pattern}`];
  if (c.emotionArc) lines.push(`  情绪曲线：${c.emotionArc}`);
  if (c.steps && c.steps.length > 0) lines.push(`  实操步骤：${c.steps.join(" → ")}`);
  if (c.transfer) lines.push(`  迁移重造：${c.transfer}`);
  if (c.mustNotCopy && c.mustNotCopy.length > 0) {
    lines.push(`  严禁照搬：${c.mustNotCopy.join("；")}`);
  }
  if (c.bannedDiction && c.bannedDiction.length > 0) {
    lines.push(`  避坑套话：${c.bannedDiction.join("；")}`);
  }
  if (c.failWhen) lines.push(`  失效边界：${c.failWhen}`);
  lines.push(`  用法：${c.usage}`);
  return lines.join("\n");
}

export function isCraftCard(card: ReferenceCardContext): boolean {
  if (card.scope === "chapter") return true;
  return card.layer === "scene" || card.layer === "chapter" || card.layer === "line";
}

export function fitItemsByBudget<T>(
  header: string,
  items: readonly T[],
  format: (item: T) => string,
  budget: number,
): { kept: T[]; lines: string[]; dropped: number } {
  const kept: T[] = [];
  const lines: string[] = [];
  let dropped = 0;
  for (const item of items) {
    const line = format(item);
    const candidate = `${header}\n${[...lines, line].join("\n")}`;
    if (estimateTokensRaw(candidate) <= budget) {
      kept.push(item);
      lines.push(line);
    } else {
      dropped += 1;
    }
  }
  return { kept, lines, dropped };
}

export function makeBlock(
  id: string,
  layer: ContextBlock["layer"],
  text: string,
  required: boolean,
  reason: string,
  source: ContextBlock["source"],
): ContextBlock {
  return {
    id,
    layer,
    text,
    required,
    tokens: estimateTokensRaw(text),
    reason,
    source,
  };
}
