import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { listChapters, readChapter } from "../commands/chapter.js";
import { createBibleStore } from "./store.js";
import type { Entity } from "./types.js";

export type EntityTimelineSource = "entity" | "chapter" | "state" | "knowledge" | "thread" | "body";

export interface EntityTimelineEvent {
  chapter: number | null;
  chapterId?: string;
  source: EntityTimelineSource;
  summary: string;
  quote?: string;
}

export interface EntityTimelineResult {
  query: string;
  matchedEntity?: Entity;
  terms: string[];
  events: EntityTimelineEvent[];
  bodyHitsTruncated: boolean;
}

export interface TraceEntityOptions {
  includeBody?: boolean;
  maxBodyHits?: number;
}

const SOURCE_ORDER: Record<EntityTimelineSource, number> = {
  entity: 0,
  chapter: 1,
  state: 2,
  knowledge: 3,
  thread: 4,
  body: 5,
};

const DEFAULT_MAX_BODY_HITS = 30;
const EXCERPT_RADIUS = 40;

function findMatchedEntity(entities: Entity[], query: string): Entity | undefined {
  const lower = query.toLowerCase();
  const exact = entities.find((entity) => {
    const candidates = [entity.id, entity.name, ...entity.aliases];
    return candidates.some((term) =>
      entity.matchCase ? term === query : term.toLowerCase() === lower,
    );
  });
  if (exact) return exact;
  return entities.find((entity) => {
    const candidates = [entity.name, ...entity.aliases];
    return candidates.some((term) => {
      if (!term.trim()) return false;
      return entity.matchCase
        ? term.includes(query) || query.includes(term)
        : term.toLowerCase().includes(lower) || lower.includes(term.toLowerCase());
    });
  });
}

function findFirstTermMatch(
  text: string,
  terms: string[],
  matchCase: boolean,
): { index: number; term: string } | null {
  const hay = matchCase ? text : text.toLowerCase();
  let bestIndex = -1;
  let bestTerm = "";
  for (const term of terms) {
    const needle = matchCase ? term : term.toLowerCase();
    const idx = hay.indexOf(needle);
    if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestTerm = term;
    }
  }
  return bestIndex === -1 ? null : { index: bestIndex, term: bestTerm };
}

function makeExcerpt(body: string, index: number, termLen: number): string {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(body.length, index + termLen + EXCERPT_RADIUS);
  const slice = body.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${slice}${end < body.length ? "…" : ""}`;
}

export async function traceEntityTimeline(
  workPath: string,
  query: string,
  options: TraceEntityOptions = {},
  lock: LockService = createLockService(systemClock),
): Promise<EntityTimelineResult> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new AppError("input.invalid", "检索词不能为空", { field: "query" });
  }

  const bible = await createBibleStore(lock).read(workPath);
  const matchedEntity = findMatchedEntity(bible.entities, trimmed);
  const matchCase = Boolean(matchedEntity?.matchCase);
  const terms = [
    ...new Set(
      [trimmed, ...(matchedEntity ? [matchedEntity.name, ...matchedEntity.aliases] : [])]
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);

  const hasTerm = (text: string): boolean => findFirstTermMatch(text, terms, matchCase) !== null;
  const events: EntityTimelineEvent[] = [];

  if (matchedEntity) {
    events.push({
      chapter: matchedEntity.provenance.chapter ?? null,
      source: "entity",
      summary: `${matchedEntity.name}（${matchedEntity.kind}）：${matchedEntity.summary}`,
    });
  }

  for (const state of bible.states) {
    const matchById = matchedEntity ? state.entity === matchedEntity.id : false;
    if (matchById || hasTerm(state.entity) || hasTerm(state.field) || hasTerm(state.value)) {
      const span = state.until !== undefined ? `（至第 ${state.until} 章）` : "";
      events.push({
        chapter: state.since,
        source: "state",
        summary: `${state.field}：${state.value}${span}`,
        ...(state.evidence?.quote ? { quote: state.evidence.quote } : {}),
      });
    }
  }

  for (const row of bible.knowledge) {
    if (hasTerm(row.holder) || hasTerm(row.fact)) {
      events.push({
        chapter: row.since,
        source: "knowledge",
        summary: `${row.holder}「${row.level}」：${row.fact}`,
        ...(row.evidence?.quote ? { quote: row.evidence.quote } : {}),
      });
    }
  }

  for (const thread of bible.threads) {
    const titleMatched = hasTerm(thread.title);
    for (const beat of thread.beats) {
      if (
        titleMatched ||
        hasTerm(beat.note) ||
        (beat.evidence?.quote && hasTerm(beat.evidence.quote))
      ) {
        events.push({
          chapter: beat.chapter,
          source: "thread",
          summary: `伏笔「${thread.title}」(${beat.kind})：${beat.note}`,
          ...(beat.evidence?.quote ? { quote: beat.evidence.quote } : {}),
        });
      }
    }
  }

  for (const chapter of bible.chapters) {
    const positionMatched = Object.entries(chapter.handoff.positions).some(
      ([k, v]) => hasTerm(k) || hasTerm(v),
    );
    const carriedMatched = chapter.handoff.carried.some((item) => hasTerm(item));
    if (
      hasTerm(chapter.summary) ||
      hasTerm(chapter.hook) ||
      hasTerm(chapter.handoff.ending) ||
      positionMatched ||
      carriedMatched
    ) {
      events.push({
        chapter: chapter.position,
        chapterId: chapter.chapter,
        source: "chapter",
        summary: `第 ${chapter.position} 章摘要：${chapter.summary}`,
      });
    }
  }

  let bodyHitsTruncated = false;
  if (options.includeBody) {
    const maxBodyHits = Math.max(1, options.maxBodyHits ?? DEFAULT_MAX_BODY_HITS);
    let bodyHits = 0;
    const rows = await listChapters(workPath);
    for (const row of rows) {
      const doc = await readChapter(workPath, row.id).catch(() => undefined);
      if (!doc) continue;
      const hay = matchCase ? doc.body : doc.body.toLowerCase();
      let cursor = 0;
      while (cursor < doc.body.length) {
        let nextIndex = -1;
        let nextTerm = "";
        for (const term of terms) {
          const needle = matchCase ? term : term.toLowerCase();
          const idx = hay.indexOf(needle, cursor);
          if (idx !== -1 && (nextIndex === -1 || idx < nextIndex)) {
            nextIndex = idx;
            nextTerm = term;
          }
        }
        if (nextIndex === -1) break;
        if (bodyHits >= maxBodyHits) {
          bodyHitsTruncated = true;
          break;
        }
        const quote = makeExcerpt(doc.body, nextIndex, nextTerm.length);
        events.push({
          chapter: row.position,
          chapterId: row.id,
          source: "body",
          summary: `正文提及「${nextTerm}」（${row.title}）`,
          quote,
        });
        bodyHits += 1;
        cursor = nextIndex + Math.max(1, nextTerm.length);
      }
      if (bodyHitsTruncated) break;
    }
  }

  events.sort((a, b) => {
    if (a.chapter === null && b.chapter !== null) return -1;
    if (a.chapter !== null && b.chapter === null) return 1;
    if (a.chapter !== null && b.chapter !== null && a.chapter !== b.chapter) {
      return a.chapter - b.chapter;
    }
    return SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source];
  });

  return {
    query: trimmed,
    ...(matchedEntity ? { matchedEntity } : {}),
    terms,
    events,
    bodyHitsTruncated,
  };
}
