import { estimateTokensRaw } from "@zhizhang/core/model";
import type { ContextBlock, ContextPacket } from "@zhizhang/core/pipeline";
import type { Bible, BibleView, EntityHit } from "../bible/types.js";

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

export function tokenize2Grams(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (!cleaned) return [];
  const tokens: string[] = [];
  for (const seg of cleaned.split(/\s+/)) {
    if (seg.length === 0) continue;
    if (seg.length === 1) {
      tokens.push(seg);
      continue;
    }
    for (let i = 0; i < seg.length - 1; i++) {
      tokens.push(seg.slice(i, i + 2));
    }
  }
  return tokens;
}

export function retrieveEarlyChapters(
  query: string,
  docs: EarlyChapterDoc[],
  topK = 3,
): RetrievedChapterHit[] {
  if (docs.length === 0 || topK <= 0) return [];
  const queryTerms = tokenize2Grams(query);
  if (queryTerms.length === 0) return [];

  const uniqueQueryTerms = Array.from(new Set(queryTerms));
  const tokenizedDocs = docs.map((doc) => {
    const terms = tokenize2Grams(`${doc.summary}\n${doc.body ?? ""}`);
    const tf = new Map<string, number>();
    for (const term of terms) {
      tf.set(term, (tf.get(term) ?? 0) + 1);
    }
    return { doc, length: terms.length, tf };
  });

  const avgDl =
    tokenizedDocs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, tokenizedDocs.length);
  if (avgDl === 0) return [];

  const df = new Map<string, number>();
  for (const term of uniqueQueryTerms) {
    let count = 0;
    for (const d of tokenizedDocs) {
      if ((d.tf.get(term) ?? 0) > 0) count += 1;
    }
    df.set(term, count);
  }

  const k1 = 1.5;
  const b = 0.75;
  const N = tokenizedDocs.length;
  const hits: RetrievedChapterHit[] = [];

  for (const d of tokenizedDocs) {
    let score = 0;
    let matchedTerms = 0;
    for (const term of uniqueQueryTerms) {
      const freq = d.tf.get(term) ?? 0;
      if (freq === 0) continue;
      matchedTerms += 1;
      const docFreq = df.get(term) ?? 0;
      const idf = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
      const tfNorm = (freq * (k1 + 1)) / (freq + k1 * (1 - b + (b * d.length) / avgDl));
      score += idf * tfNorm;
    }
    if (score > 0) {
      hits.push({ doc: d.doc, score, matchedTerms });
    }
  }

  return hits
    .sort(
      (a, bHit) =>
        bHit.score - a.score ||
        bHit.matchedTerms - a.matchedTerms ||
        bHit.doc.position - a.doc.position,
    )
    .slice(0, topK);
}

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

  const l2Text = input.hits
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

  const usedTokens = [...prefix, ...suffix].reduce((sum, b) => sum + b.tokens, 0);
  let remaining = Math.max(0, input.budget - usedTokens);

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
  return { prefix, suffix, omitted, estimate };
}
