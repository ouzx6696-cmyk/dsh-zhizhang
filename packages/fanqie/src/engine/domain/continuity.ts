/**
 * 结构化连续性的纯巡检逻辑：只抽取候选、不判定对错（与 ledger 抽取同一口径）。
 * 输入是已解析的领域对象与章正文，不碰文件系统；落盘与读取在 storage/continuity.ts。
 */
import type { ForeshadowLine, KnowledgeItem } from "../types.js";

interface ChapterBodySlice {
  position: number;
  body: string;
}

/** 知情越界候选：记录为「不知」的人物在窗口章的正文里与事实同段出现。 */
interface KnowledgeBreachCandidate {
  knowledgeId: string;
  fact: string;
  who: string;
  chapter: number;
  /** 命中事实的那一行正文（截断） */
  quote: string;
}

const QUOTE_MAX = 80;

function quoteAround(line: string, needle: string) {
  const at = line.indexOf(needle);
  const start = Math.max(0, at - 20);
  const text = line.slice(start, start + QUOTE_MAX).trim();
  return start > 0 ? `…${text}` : text;
}

/**
 * 对每个知识条目的每段「不知」状态（since 起，到该人物后一段知情/公开/误认状态为止，
 * 没有后继状态则到最后一章），找正文同时出现人物名与事实原文的章。误认状态的求真核对
 * 需要语义判断，不在机械巡检范围内。
 */
export function knowledgeBreachCandidates(
  items: KnowledgeItem[],
  chapters: ChapterBodySlice[],
): KnowledgeBreachCandidate[] {
  const ordered = [...chapters].sort((a, b) => a.position - b.position);
  const found: KnowledgeBreachCandidate[] = [];
  for (const item of items) {
    const byWho = new Map<string, KnowledgeItem["holders"]>();
    for (const holder of item.holders) {
      const list = byWho.get(holder.who) ?? [];
      list.push(holder);
      byWho.set(holder.who, list);
    }
    for (const [who, entries] of byWho) {
      const sorted = [...entries].sort((a, b) => a.since - b.since);
      for (let i = 0; i < sorted.length; i++) {
        const holder = sorted[i];
        if (holder.level !== "不知") continue;
        const until = sorted[i + 1]?.since ?? Number.POSITIVE_INFINITY;
        for (const chapter of ordered) {
          if (chapter.position < holder.since || chapter.position >= until) continue;
          // 大部分章节不含该事实，先排除再分行，避免每条知识重复分配全文行数组。
          if (!chapter.body.includes(who) || !chapter.body.includes(item.fact)) continue;
          const hit = chapter.body
            .split("\n")
            .find((line) => line.includes(who) && line.includes(item.fact));
          if (hit)
            found.push({
              knowledgeId: item.id,
              fact: item.fact,
              who,
              chapter: chapter.position,
              quote: quoteAround(hit, item.fact),
            });
        }
      }
    }
  }
  return found;
}

/**
 * 被遗忘伏笔：plannedPayoff 已过（≤ 当前最后一章章号）且状态仍停在 planned/written 的线。
 * committed/missed 不再列。
 */
export function forgottenForeshadows(
  lines: ForeshadowLine[],
  lastPosition: number,
): ForeshadowLine[] {
  if (!Number.isFinite(lastPosition) || lastPosition <= 0) return [];
  return lines.filter(
    (line) =>
      (line.status === "planned" || line.status === "written") &&
      Number.isFinite(line.plannedPayoff) &&
      line.plannedPayoff <= lastPosition,
  );
}

/** commit 引用格式：`线id:章号`。 */
export function beatReference(lineId: string, chapter: number) {
  return `${lineId}:${chapter}`;
}
export function parseBeatReference(ref: string) {
  const at = ref.lastIndexOf(":");
  if (at <= 0) return { lineId: ref, chapter: NaN };
  return { lineId: ref.slice(0, at), chapter: Number(ref.slice(at + 1)) };
}
