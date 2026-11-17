/** 设定库查询与实体全貌。 */
import { AppError } from "@zhizhang/core/errors";
import { asOf } from "./asof.js";
import { replacesOverlap } from "./interval.js";
import type { BibleLib } from "./read.js";
import type {
  Entity,
  LedgerEntry,
  StateEntry,
  Thread,
  TimelineEvent,
  KnowledgeRow,
} from "./types.js";

export interface BibleFilter {
  kind?: Entity["kind"];
  facet?: StateEntry["facet"];
  source?: Entity["provenance"]["source"];
  status?: StateEntry["status"];
  conflict?: boolean;
  stale?: boolean;
  appearIn?: [number, number];
  q?: string;
}

export interface BibleQueryItem {
  entity: Entity;
  states: StateEntry[];
}

export interface BibleEntityView {
  entity: Entity;
  states: StateEntry[];
  relations: StateEntry[];
  threads: Thread[];
  appearances: number[];
}

export interface PageInput {
  offset: number;
  limit: number;
}

type Snapshot = {
  entities: Entity[];
  timeline: TimelineEvent[];
  states: StateEntry[];
  threads: Thread[];
  knowledge: KnowledgeRow[];
};

function ledgersOf(lib: BibleLib): LedgerEntry[] {
  return [...lib.ledgers.values()].sort((a, b) => a.position - b.position);
}

function activeStates(lib: BibleLib, position?: number): StateEntry[] {
  if (position === undefined) return lib.bible.states;
  return asOf(lib.bible, position, ledgersOf(lib)).states;
}

function stateIsStale(state: StateEntry, ledgers: Map<string, LedgerEntry>): boolean {
  if (!state.evidence) return false;
  const ledger = ledgers.get(String(state.evidence.chapter));
  return !ledger || ledger.revision !== state.evidence.revision;
}

function entityThreads(bible: Snapshot, entity: Entity): Thread[] {
  const names = [entity.name, ...entity.aliases].filter((name) => name.trim().length > 0);
  return bible.threads.filter((thread) => {
    const text = [thread.title, ...thread.beats.map((beat) => beat.note)].join("\n");
    return names.some((name) => text.includes(name));
  });
}

export function queryBible(
  lib: BibleLib,
  filter: BibleFilter,
  position: number | undefined,
  page: PageInput,
): { items: BibleQueryItem[]; total: number } {
  const states = activeStates(lib, position);
  const ledgers = lib.ledgers;
  const query = filter.q?.trim().toLowerCase();
  const items: BibleQueryItem[] = [];

  for (const entity of lib.bible.entities) {
    if (filter.kind && entity.kind !== filter.kind) continue;
    if (filter.source && entity.provenance.source !== filter.source) continue;
    if (query) {
      const hay = [entity.id, entity.name, ...entity.aliases, entity.summary]
        .join("\n")
        .toLowerCase();
      if (!hay.includes(query)) continue;
    }
    const own = states
      .filter((state) => state.entity === entity.id)
      .sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
    let matched = own;
    if (filter.facet) matched = matched.filter((state) => state.facet === filter.facet);
    if (filter.status) matched = matched.filter((state) => state.status === filter.status);
    if (filter.facet || filter.status) {
      if (matched.length === 0) continue;
    }
    if (filter.conflict && replacesOverlap(own).length === 0) continue;
    if (filter.stale && !own.some((state) => stateIsStale(state, ledgers))) continue;
    if (filter.appearIn) {
      const [from, to] = filter.appearIn;
      const appears = [...ledgers.values()].some(
        (entry) =>
          entry.position >= from &&
          entry.position <= to &&
          entry.appearances.some((appearance) => appearance.entity === entity.id),
      );
      if (!appears) continue;
    }
    items.push({ entity, states: matched });
  }

  items.sort(
    (a, b) => a.entity.name.localeCompare(b.entity.name) || a.entity.id.localeCompare(b.entity.id),
  );
  return {
    items: items.slice(page.offset, page.offset + page.limit),
    total: items.length,
  };
}

export function entityView(lib: BibleLib, id: string, position?: number): BibleEntityView {
  const entity = lib.bible.entities.find((candidate) => candidate.id === id);
  if (!entity) {
    throw new AppError("input.not_found", `实体不存在：${id}`, { id });
  }
  const states = activeStates(lib, position)
    .filter((state) => state.entity === id || state.target === id)
    .sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
  const appearances = [...lib.ledgers.values()]
    .filter((entry) => entry.appearances.some((appearance) => appearance.entity === id))
    .map((entry) => entry.position)
    .sort((a, b) => a - b);
  return {
    entity,
    states,
    relations: states.filter((state) => state.facet === "relation"),
    threads: entityThreads(lib.bible, entity),
    appearances,
  };
}
