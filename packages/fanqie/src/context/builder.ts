import { AppError } from "@zhizhang/core/errors";
import { retrieveEarlyChapters } from "./select.js";
import { estimateTokensRaw } from "@zhizhang/core/model";
import type { ContextBlock, ContextPacket } from "@zhizhang/core/pipeline";
import type { BibleSnapshot, BibleView, EntityHit, LedgerEntry } from "../bible/types.js";

export type PreviousTextMode = { kind: "full"; maxChars: number } | { kind: "tail"; chars: number };

export interface EarlyChapterDoc {
  chapter: string;
  position: number;
  summary: string;
  body?: string;
}

export interface RetrievedChapterHit {
  doc: EarlyChapterDoc;
  score: number;
  matchedTerms: number;
}

export interface BookPlanContext {
  title?: string;
  coreConflict?: string;
  currentVolume?: {
    volume: number;
    title: string;
    summary: string;
  };
  currentAct?: { title: string; summary: string };
}

export interface ReferenceCardContext {
  id: string;
  title: string;
  category: string;
  pattern: string;
  usage: string;
}

export interface ChapterContextInput {
  chapterId: string;
  position: number;
  outlineText: string;
  authorNote?: string;
  requiredEntityIds?: string[];
  requiredThreadIds?: string[];
  previousBody?: string;
  previousHandoff?: string;
  previousSummary?: string;
  bible: BibleSnapshot;
  /** 记账产物；缺省视为无历史。 */
  ledgers?: LedgerEntry[];
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

export { tokenize2Grams, retrieveEarlyChapters } from "./select.js";

export function buildChapterContext(input: ChapterContextInput): ContextPacket {
  const prefix: ContextBlock[] = [];
  const suffix: ContextBlock[] = [];
  const omitted: { id: string; why: string }[] = [];

  const prevText = (() => {
    if (!input.previousBody) return "";
    if (input.previousTextMode.kind === "full") {
      return input.previousBody.slice(-input.previousTextMode.maxChars);
    }
    return input.previousBody.slice(-input.previousTextMode.chars);
  })();

  const l1Parts = [
    input.previousSummary ? `【前章摘要】\n${input.previousSummary}` : "",
    input.previousHandoff ? `【章末交接】\n${input.previousHandoff}` : "",
    prevText ? `【前文】\n${prevText}` : "",
  ].filter(Boolean);
  if (l1Parts.length > 0) {
    prefix.push(
      makeBlock("l1-continuity", 1, l1Parts.join("\n\n"), true, "前章接续与前文", {
        kind: "chapter",
        ref: `pos:${Math.max(1, input.position - 1)}`,
      }),
    );
  }

  const requiredIds = new Set(input.requiredEntityIds ?? []);
  const presentIds = new Set(input.hits.map((hit) => hit.entity.id));
  const l2Text = input.hits
    .filter((hit) => !requiredIds.has(hit.entity.id))
    .map((h) => {
      const states = input.view.states
        .filter((s) => s.entity === h.entity.id)
        .map((s) => `${s.field}=${s.value}`)
        .join("；");
      return `- ${h.entity.name}（${h.entity.kind}）：${h.entity.summary}${states ? `；状态：${states}` : ""}`;
    })
    .join("\n");
  if (l2Text) {
    prefix.push(
      makeBlock("l2-entities", 2, `【在场与全局实体】\n${l2Text}`, false, "按章纲与前文命中纳入", {
        kind: "bible",
        ref: "entities",
      }),
    );
  }

  const requiredEntities = input.hits.filter((hit) => requiredIds.has(hit.entity.id));
  if (requiredEntities.length)
    prefix.push(
      makeBlock(
        "l2-required",
        2,
        requiredEntities
          .map(
            (hit) =>
              `${hit.entity.id} ${hit.entity.name}: ${hit.entity.summary}; ${input.view.states
                .filter((state) => state.entity === hit.entity.id)
                .map((state) => `${state.field}=${state.value}`)
                .join("；")}; locked=${hit.entity.locked.join("；")}`,
          )
          .join("\n"),
        true,
        "章纲点名",
        { kind: "bible", ref: "required-entities" },
      ),
    );
  const knowledge = input.view.knowledge.filter((row) => presentIds.has(row.holder));
  const threads = input.view.threads.filter(
    (thread) =>
      thread.status === "open" &&
      (input.requiredThreadIds?.includes(thread.id) ||
        (thread.dueBy ?? thread.plannedPayoff ?? Infinity) <= input.position + 3 ||
        input.hits.some((hit) => thread.title.includes(hit.entity.name))),
  );
  const l3Parts: string[] = [];
  if (knowledge.length > 0) {
    l3Parts.push(
      "【知情边界】\n" +
        knowledge.map((k) => `- ${k.holder} 对「${k.fact}」：${k.level}`).join("\n"),
    );
  }
  if (threads.length > 0) {
    l3Parts.push(
      "【有效伏笔/线索】\n" +
        threads
          .map(
            (t) =>
              `- ${t.title}（第${t.opened}章埋设${t.plannedPayoff ? `，计划第${t.plannedPayoff}章兑现` : ""}）`,
          )
          .join("\n"),
    );
  }
  const relations = input.view.states.filter(
    (state) =>
      state.facet === "relation" &&
      presentIds.has(state.entity) &&
      Boolean(state.target && presentIds.has(state.target)),
  );
  if (relations.length > 0) {
    const namesById = new Map(input.hits.map((hit) => [hit.entity.id, hit.entity.name]));
    l3Parts.push(
      "【在场人物关系】\n" +
        relations
          .map(
            (state) =>
              `- ${namesById.get(state.entity) ?? state.entity} ${state.field} ${namesById.get(state.target ?? "") ?? state.target}：${state.value}`,
          )
          .join("\n"),
    );
  }
  if (l3Parts.length > 0) {
    prefix.push(
      makeBlock("l3-constraints", 3, l3Parts.join("\n\n"), true, "知情与伏笔硬约束", {
        kind: "bible",
        ref: "constraints",
      }),
    );
  }

  const rulesBlock = input.bible.style.rules.length
    ? `\n\n【个人规则】\n${input.bible.style.rules.map((r) => `- ${r.condition} -> ${r.change}`).join("\n")}`
    : "";
  const noteBlock = input.authorNote ? `\n\n【作者要求】\n${input.authorNote}` : "";
  suffix.push(
    makeBlock(
      "l0-task",
      0,
      `【本章章纲】\n${input.outlineText}${rulesBlock}${noteBlock}`,
      true,
      "本章任务目标",
      { kind: "outline", ref: input.chapterId },
    ),
  );

  const avail = Math.max(0, input.budget - 1000);
  const required = [...prefix, ...suffix]
    .filter((block) => block.required)
    .reduce((sum, block) => sum + block.tokens, 0);
  if (required > avail)
    throw new AppError("model.context_overflow", "必带上下文超出输入预算", {
      required,
      available: avail,
    });
  let remaining = avail - required;
  for (let i = prefix.length - 1; i >= 0; i--) {
    const block = prefix[i];
    if (block.required) continue;
    if (block.tokens > remaining || block.tokens > avail * 0.25) {
      prefix.splice(i, 1);
      omitted.push({ id: block.id, why: "budget:L2" });
    } else remaining -= block.tokens;
  }

  const recentFacts = (input.view.recentFacts ?? [])
    .filter((fact) => fact.entities.some((id) => presentIds.has(id)))
    .sort((a, b) => b.position - a.position)
    .map((fact) => `- 第${fact.position}章：${fact.text.slice(0, 120)}`);
  const l4Parts = [
    ...input.recentSummaries.map((summary) => `第${summary.position}章：${summary.summary}`),
    ...recentFacts,
  ];
  if (input.bookPlan?.currentVolume)
    l4Parts.push(`本卷摘要：${input.bookPlan.currentVolume.summary}`);
  if (input.bookPlan?.currentAct)
    l4Parts.push(
      `本幕「${input.bookPlan.currentAct.title}」摘要：${input.bookPlan.currentAct.summary}`,
    );
  const l4Text = l4Parts.join("\n");
  if (l4Text) {
    const l4Block = makeBlock("l4-recent", 4, `【近期回顾】\n${l4Text}`, false, "近10章摘要", {
      kind: "bible",
      ref: "chapters",
    });
    if (l4Block.tokens <= remaining && l4Block.tokens <= avail * 0.15) {
      suffix.push(l4Block);
      remaining -= l4Block.tokens;
    } else {
      omitted.push({ id: l4Block.id, why: "超出剩余预算" });
    }
  }

  const earlyCandidates: EarlyChapterDoc[] =
    input.earlyChapters ??
    (input.ledgers ?? [])
      .filter((c) => c.position < Math.max(1, input.position - 10))
      .map((c) => ({
        chapter: c.chapter,
        position: c.position,
        summary: c.summary,
      }));
  const retrievalQuery = [
    input.outlineText,
    input.authorNote ?? "",
    input.previousSummary ?? "",
    input.previousHandoff ?? "",
    input.previousBody?.slice(-1500) ?? "",
    ...input.hits.map((hit) => hit.entity.name),
    ...threads.map((thread) => thread.title),
  ]
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
    if (l5Block.tokens <= remaining && l5Block.tokens <= avail * 0.1) {
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
  if (input.referenceCards && input.referenceCards.length > 0) {
    const cardLines = input.referenceCards.map(
      (c) => `- [${c.category}] ${c.title}：${c.pattern}（用法：${c.usage}）`,
    );
    l6Parts.push(`【绑定参考卡（参考机制，不复制）】\n${cardLines.join("\n")}`);
  }
  if (l6Parts.length > 0) {
    const l6Block = makeBlock(
      "l6-plan-reference",
      6,
      l6Parts.join("\n\n"),
      false,
      "卷/全书规划与绑定参考卡（参考机制，不复制）",
      {
        kind: input.referenceCards && input.referenceCards.length > 0 ? "reference" : "plan",
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
  return { prefix, suffix, omitted, estimate, reserve: 1000 };
}
