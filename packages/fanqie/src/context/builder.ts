import { estimateTokensRaw } from "@zhizhang/core/model";
import type { ContextBlock, ContextPacket } from "@zhizhang/core/pipeline";
import type { Bible, BibleView, EntityHit } from "../bible/types.js";
import { retrieveEarlyChapters, type EarlyChapterDoc } from "./retrieval.js";

export {
  retrieveEarlyChapters,
  tokenize2Grams,
  type EarlyChapterDoc,
  type RetrievedChapterHit,
} from "./retrieval.js";

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

function formatReferenceCard(c: ReferenceCardContext): string {
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

function isCraftCard(card: ReferenceCardContext): boolean {
  if (card.scope === "chapter") return true;
  return card.layer === "scene" || card.layer === "chapter" || card.layer === "line";
}

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
}

function makeBlock(
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
  if (craftCards.length > 0) {
    const craftText = `【本章实操技法卡（只迁机制，严禁洗稿）】\n${craftCards.map(formatReferenceCard).join("\n")}`;
    const craftBlock = makeBlock(
      "l2-craft",
      2,
      craftText,
      false,
      "本章绑定实操技法卡与防抄袭红线",
      {
        kind: "reference",
        ref: "craft-cards",
      },
    );
    if (craftBlock.tokens <= remaining) {
      suffix.push(craftBlock);
      remaining -= craftBlock.tokens;
    } else {
      omitted.push({ id: craftBlock.id, why: "超出剩余预算" });
    }
  }

  const l4Text = input.recentSummaries.map((s) => `第${s.position}章：${s.summary}`).join("\n");
  if (l4Text) {
    const l4Block = makeBlock("l4-recent", 4, `【近期回顾】\n${l4Text}`, false, "近10章摘要", {
      kind: "bible",
      ref: "chapters",
    });
    if (l4Block.tokens <= remaining) {
      suffix.push(l4Block);
      remaining -= l4Block.tokens;
    } else {
      omitted.push({ id: l4Block.id, why: "超出剩余预算" });
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
    const l5Text = earlyHits
      .map((hit) => {
        const excerpt = hit.doc.body ? `；片段：${hit.doc.body.slice(0, 120)}` : "";
        return `第${hit.doc.position}章（${hit.doc.chapter}）：${hit.doc.summary}${excerpt}`;
      })
      .join("\n");
    const l5Block = makeBlock(
      "l5-retrieval",
      5,
      `【早期章节检索】\n${l5Text}`,
      false,
      "早期章节 BM25 + 字符 2-gram 检索",
      { kind: "retrieval", ref: "chapters" },
    );
    if (l5Block.tokens <= remaining) {
      suffix.push(l5Block);
      remaining -= l5Block.tokens;
    } else {
      omitted.push({ id: l5Block.id, why: "超出剩余预算" });
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
      l6Parts.push(`【卷/全书规划】\n${planLines.join("\n")}`);
    }
  }
  if (macroCards.length > 0) {
    const cardLines = macroCards.map(formatReferenceCard);
    l6Parts.push(`【全书参考技法卡（参考机制，不复制）】\n${cardLines.join("\n")}`);
  }
  if (l6Parts.length > 0) {
    const l6Block = makeBlock(
      "l6-plan-reference",
      6,
      l6Parts.join("\n\n"),
      false,
      "卷/全书规划与全书参考卡（参考机制，不复制）",
      {
        kind: macroCards.length > 0 ? "reference" : "plan",
        ref: "plan-and-cards",
      },
    );
    if (l6Block.tokens <= remaining) {
      suffix.push(l6Block);
      remaining -= l6Block.tokens;
    } else {
      omitted.push({ id: l6Block.id, why: "超出剩余预算" });
    }
  }

  const estimate = [...prefix, ...suffix].reduce((sum, b) => sum + b.tokens, 0);
  return { prefix, suffix, omitted, estimate };
}
