import { estimateTokensRaw } from "@zhizhang/core/model";
import type { ContextBlock, ContextPacket } from "@zhizhang/core/pipeline";
import type { Bible, BibleView, EntityHit } from "../bible/types.js";
import {
  fitItemsByBudget,
  formatReferenceCard,
  isCraftCard,
  makeBlock,
  type BookPlanContext,
  type PreviousTextMode,
  type ReferenceCardContext,
} from "./format.js";
import { retrieveEarlyChapters, type EarlyChapterDoc } from "./retrieval.js";

export {
  type BookPlanContext,
  type PreviousTextMode,
  type ReferenceCardContext,
} from "./format.js";
export {
  retrieveEarlyChapters,
  tokenize2Grams,
  type EarlyChapterDoc,
  type RetrievedChapterHit,
} from "./retrieval.js";

export interface ChapterContextInput {
  chapterId: string;
  position: number;
  outlineText: string;
  authorNote?: string;
  brief?: {
    goal?: string;
    agreedBeats?: string[];
    mustKeepQuotes?: string[];
    avoidPatterns?: string[];
  };
  previousBody?: string;
  previousHandoff?: string;
  previousSummary?: string;
  bible: Bible;
  view: BibleView;
  hits: EntityHit[];
  recentSummaries: { position: number; summary: string }[];
  earlyChapters?: EarlyChapterDoc[];
  l5TopK?: number;
  bookPlan?: BookPlanContext;
  referenceCards?: ReferenceCardContext[];
  budget: number;
  previousTextMode: PreviousTextMode;
  onIncludedCards?: (ids: string[]) => void;
}

export function buildChapterContext(input: ChapterContextInput): ContextPacket {
  const prefix: ContextBlock[] = [];
  const suffix: ContextBlock[] = [];
  const omitted: { id: string; why: string }[] = [];

  const rulesBlock = input.bible.style.rules.length
    ? `\n\n【个人规则】\n${input.bible.style.rules.map((r) => `- ${r.condition} -> ${r.change}`).join("\n")}`
    : "";
  const noteBlock = input.authorNote ? `\n\n【作者要求】\n${input.authorNote}` : "";
  const briefParts: string[] = [];
  if (input.brief?.goal) briefParts.push(`目标：${input.brief.goal}`);
  if (input.brief?.agreedBeats?.length) {
    briefParts.push(
      `确认节拍：\n${input.brief.agreedBeats.map((b, i) => `${i + 1}. ${b}`).join("\n")}`,
    );
  }
  if (input.brief?.mustKeepQuotes?.length) {
    briefParts.push(
      `必须保留原句：\n${input.brief.mustKeepQuotes.map((q) => `「${q}」`).join("\n")}`,
    );
  }
  if (input.brief?.avoidPatterns?.length) {
    briefParts.push(`本轮规避：${input.brief.avoidPatterns.join("；")}`);
  }
  const briefBlock = briefParts.length ? `\n\n【写作任务单】\n${briefParts.join("\n")}` : "";
  const l0Block = makeBlock(
    "l0-task",
    0,
    `【本章章纲】\n${input.outlineText}${rulesBlock}${noteBlock}${briefBlock}`,
    true,
    "本章任务目标",
    { kind: "outline", ref: input.chapterId },
  );
  suffix.push(l0Block);

  const l3Parts: string[] = [];
  if (input.view.knowledge.length > 0) {
    l3Parts.push(
      "【知情边界】\n" +
        input.view.knowledge.map((k) => `- ${k.holder} 对「${k.fact}」：${k.level}`).join("\n"),
    );
  }
  if (input.view.threads.length > 0) {
    l3Parts.push(
      "【有效伏笔/线索】\n" +
        input.view.threads
          .map(
            (t) =>
              `- ${t.title}（第${t.opened}章埋设${t.plannedPayoff ? `，计划第${t.plannedPayoff}章兑现` : ""}）`,
          )
          .join("\n"),
    );
  }
  const l3Block =
    l3Parts.length > 0
      ? makeBlock("l3-constraints", 3, l3Parts.join("\n\n"), true, "知情与伏笔硬约束", {
          kind: "bible",
          ref: "constraints",
        })
      : undefined;

  const baseRequiredTokens = l0Block.tokens + (l3Block?.tokens ?? 0);
  const maxPrevChars =
    input.previousTextMode.kind === "full"
      ? input.previousTextMode.maxChars
      : input.previousTextMode.chars;
  let prevText = input.previousBody ? input.previousBody.slice(-maxPrevChars) : "";

  const buildL1Block = (text: string) => {
    const l1Parts = [
      input.previousSummary ? `【前章摘要】\n${input.previousSummary}` : "",
      input.previousHandoff ? `【章末交接】\n${input.previousHandoff}` : "",
      text ? `【前文】\n${text}` : "",
    ].filter(Boolean);
    return l1Parts.length > 0
      ? makeBlock("l1-continuity", 1, l1Parts.join("\n\n"), true, "前章接续与前文", {
          kind: "chapter",
          ref: `pos:${Math.max(1, input.position - 1)}`,
        })
      : undefined;
  };

  let l1Block = buildL1Block(prevText);
  if (l1Block && baseRequiredTokens + l1Block.tokens > input.budget && prevText.length > 200) {
    const availableForL1 = Math.max(0, input.budget - baseRequiredTokens);
    const metaOnlyTokens = buildL1Block("")?.tokens ?? 0;
    const prevTokenBudget = Math.max(0, availableForL1 - metaOnlyTokens);
    const targetChars = Math.min(prevText.length, Math.max(0, Math.floor(prevTokenBudget * 1.4)));
    prevText = targetChars > 0 ? prevText.slice(-targetChars) : "";
    l1Block = buildL1Block(prevText);
    omitted.push({ id: "l1-continuity:tail", why: "按预算收窄前文截取长度" });
  }
  if (l1Block) prefix.push(l1Block);

  const usedCore = (l1Block?.tokens ?? 0) + baseRequiredTokens;
  let remaining = Math.max(0, input.budget - usedCore);

  if (input.hits.length > 0) {
    const entityLines: string[] = [];
    let droppedEntities = 0;
    for (const h of input.hits) {
      const states = input.view.states
        .filter((s) => s.entity === h.entity.id)
        .map((s) => `${s.field}=${s.value}`)
        .join("；");
      const line = `- ${h.entity.name}（${h.entity.kind}）：${h.entity.summary}${states ? `；状态：${states}` : ""}`;
      const candidateText = `【在场与全局实体】\n${[...entityLines, line].join("\n")}`;
      if (estimateTokensRaw(candidateText) <= remaining) {
        entityLines.push(line);
      } else {
        droppedEntities += 1;
      }
    }
    if (entityLines.length > 0) {
      const l2Block = makeBlock(
        "l2-entities",
        2,
        `【在场与全局实体】\n${entityLines.join("\n")}`,
        false,
        "按章纲与前文命中纳入",
        { kind: "bible", ref: "entities" },
      );
      prefix.push(l2Block);
      remaining = Math.max(0, remaining - l2Block.tokens);
    }
    if (droppedEntities > 0) {
      omitted.push({
        id: "l2-entities",
        why: `超出剩余预算，裁剪 ${droppedEntities} 条低权重实体`,
      });
    }
  }

  if (l3Block) prefix.push(l3Block);

  const craftCards = (input.referenceCards ?? []).filter(isCraftCard);
  const macroCards = (input.referenceCards ?? []).filter((c) => !isCraftCard(c));
  const includedCardIds: string[] = [];
  if (craftCards.length > 0) {
    const header = "【本章实操技法卡（只迁机制，严禁洗稿）】";
    const fitted = fitItemsByBudget(header, craftCards, formatReferenceCard, remaining);
    if (fitted.lines.length > 0) {
      const craftBlock = makeBlock(
        "l2-craft",
        2,
        `${header}\n${fitted.lines.join("\n")}`,
        false,
        "本章绑定实操技法卡与防抄袭红线",
        { kind: "reference", ref: "craft-cards" },
      );
      suffix.push(craftBlock);
      remaining = Math.max(0, remaining - craftBlock.tokens);
      includedCardIds.push(...fitted.kept.map((c) => c.id));
    }
    if (fitted.dropped > 0) {
      omitted.push({ id: "l2-craft", why: `超出剩余预算，裁剪 ${fitted.dropped} 张实操技法卡` });
    }
  }

  if (input.recentSummaries.length > 0) {
    const header = "【近期回顾】";
    const newestFirst = [...input.recentSummaries].sort((a, b) => b.position - a.position);
    const fitted = fitItemsByBudget(
      header,
      newestFirst,
      (s) => `第${s.position}章：${s.summary}`,
      remaining,
    );
    if (fitted.kept.length > 0) {
      const chronological = [...fitted.kept]
        .sort((a, b) => a.position - b.position)
        .map((s) => `第${s.position}章：${s.summary}`);
      const l4Block = makeBlock(
        "l4-recent",
        4,
        `${header}\n${chronological.join("\n")}`,
        false,
        "近10章摘要",
        {
          kind: "bible",
          ref: "chapters",
        },
      );
      suffix.push(l4Block);
      remaining = Math.max(0, remaining - l4Block.tokens);
    }
    if (fitted.dropped > 0) {
      omitted.push({ id: "l4-recent", why: `超出剩余预算，裁剪 ${fitted.dropped} 章较早回顾` });
    }
  }

  const earlyCandidates: EarlyChapterDoc[] =
    input.earlyChapters ??
    input.bible.chapters
      .filter((c) => c.position < Math.max(1, input.position - 10))
      .map((c) => ({
        chapter: c.chapter,
        position: c.position,
        summary: c.summary,
      }));
  const retrievalQuery = [input.outlineText, input.authorNote ?? "", input.previousSummary ?? ""]
    .filter(Boolean)
    .join("\n");
  const earlyHits = retrieveEarlyChapters(retrievalQuery, earlyCandidates, input.l5TopK ?? 3);
  if (earlyHits.length > 0) {
    const header = "【早期章节检索】";
    const fitted = fitItemsByBudget(
      header,
      earlyHits,
      (hit) => {
        const excerpt = hit.doc.body ? `；片段：${hit.doc.body.slice(0, 120)}` : "";
        return `第${hit.doc.position}章（${hit.doc.chapter}）：${hit.doc.summary}${excerpt}`;
      },
      remaining,
    );
    if (fitted.lines.length > 0) {
      const l5Block = makeBlock(
        "l5-retrieval",
        5,
        `${header}\n${fitted.lines.join("\n")}`,
        false,
        "早期章节 BM25 + 字符 2-gram 检索",
        { kind: "retrieval", ref: "chapters" },
      );
      suffix.push(l5Block);
      remaining = Math.max(0, remaining - l5Block.tokens);
    }
    if (fitted.dropped > 0) {
      omitted.push({ id: "l5-retrieval", why: `超出剩余预算，裁剪 ${fitted.dropped} 条早期检索` });
    }
  }

  const l6Parts: string[] = [];
  if (input.bookPlan) {
    const planLines: string[] = [];
    if (input.bookPlan.title) planLines.push(`书名：${input.bookPlan.title}`);
    if (input.bookPlan.coreConflict) planLines.push(`主线冲突：${input.bookPlan.coreConflict}`);
    if (input.bookPlan.currentVolume) {
      const vol = input.bookPlan.currentVolume;
      planLines.push(`第${vol.volume}卷「${vol.title}」：${vol.summary}`);
    }
    if (planLines.length > 0) {
      const planText = `【卷/全书规划】\n${planLines.join("\n")}`;
      if (estimateTokensRaw(planText) <= remaining) {
        l6Parts.push(planText);
      } else {
        omitted.push({ id: "l6-plan", why: "超出剩余预算" });
      }
    }
  }
  if (macroCards.length > 0) {
    const planTokens = l6Parts.length > 0 ? estimateTokensRaw(l6Parts[0]) + 2 : 0;
    const header = "【全书参考技法卡（参考机制，不复制）】";
    const fitted = fitItemsByBudget(
      header,
      macroCards,
      formatReferenceCard,
      Math.max(0, remaining - planTokens),
    );
    if (fitted.lines.length > 0) {
      l6Parts.push(`${header}\n${fitted.lines.join("\n")}`);
      includedCardIds.push(...fitted.kept.map((c) => c.id));
    }
    if (fitted.dropped > 0) {
      omitted.push({
        id: "l6-plan-reference",
        why: `超出剩余预算，裁剪 ${fitted.dropped} 张全书参考卡`,
      });
    }
  }
  if (l6Parts.length > 0) {
    const l6Block = makeBlock(
      "l6-plan-reference",
      6,
      l6Parts.join("\n\n"),
      false,
      "卷/全书规划与全书参考卡（参考机制，不复制）",
      { kind: macroCards.length > 0 ? "reference" : "plan", ref: "plan-and-cards" },
    );
    suffix.push(l6Block);
    remaining = Math.max(0, remaining - l6Block.tokens);
  }

  input.onIncludedCards?.(includedCardIds);
  const estimate = [...prefix, ...suffix].reduce((sum, b) => sum + b.tokens, 0);
  return { prefix, suffix, omitted, estimate };
}
