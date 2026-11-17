/** 操作目标的定位、版本读取与内部删除载体。 */
import type {
  AnyOp,
  BibleOp,
  Entity,
  KnowledgeRow,
  LedgerEntry,
  StateEntry,
  Thread,
  TimelineEvent,
} from "./types.js";
import type { BibleLib } from "./read.js";

export type RecordKind = "entity" | "timeline" | "thread" | "knowledge" | "state" | "ledger";

export type FoundRecord =
  | { kind: "entity"; id: string; rev: number; value: Entity }
  | { kind: "timeline"; id: string; rev: number; value: TimelineEvent }
  | { kind: "thread"; id: string; rev: number; value: Thread }
  | { kind: "knowledge"; id: string; rev: number; value: KnowledgeRow }
  | { kind: "state"; id: string; rev: number; value: StateEntry }
  | { kind: "ledger"; id: string; rev: number; value: LedgerEntry };

export const clone = <T>(value: T): T => structuredClone(value);

/** ledger 的版本键加前缀，避免与实体/状态 id 冲突。 */
export function ledgerTarget(chapter: string): string {
  return `ledger:${chapter}`;
}

export function targetId(op: AnyOp): string | undefined {
  switch (op.type) {
    case "entity.upsert":
      return op.entity.id;
    case "entity.merge":
      return op.keep;
    case "entity.delete":
    case "state.update":
    case "state.delete":
      return op.id;
    case "timeline.upsert":
      return op.event.id;
    case "state.add":
      return op.entry.id;
    case "thread.upsert":
      return op.thread.id;
    case "thread.beat":
      return op.thread;
    case "knowledge.set":
      return op.row.id;
    case "ledger.write":
      return ledgerTarget(op.entry.chapter);
    case "style.update":
      return "style";
    default:
      return undefined;
  }
}

export function findRecord(lib: BibleLib, id: string): FoundRecord | undefined {
  if (id.startsWith("ledger:")) {
    const entry = lib.ledgers.get(id.slice("ledger:".length));
    return entry ? { kind: "ledger", id, rev: entry.rev, value: entry } : undefined;
  }
  const entity = lib.bible.entities.find((item) => item.id === id);
  if (entity) return { kind: "entity", id, rev: entity.rev, value: entity };
  const event = lib.bible.timeline.find((item) => item.id === id);
  if (event) return { kind: "timeline", id, rev: event.rev, value: event };
  const thread = lib.bible.threads.find((item) => item.id === id);
  if (thread) return { kind: "thread", id, rev: thread.rev, value: thread };
  const row = lib.bible.knowledge.find((item) => item.id === id);
  if (row) return { kind: "knowledge", id, rev: row.rev, value: row };
  const state = lib.bible.states.find((item) => item.id === id);
  if (state) return { kind: "state", id, rev: state.rev, value: state };
  return undefined;
}

export function currentRev(lib: BibleLib, op: AnyOp): number | undefined {
  const id = targetId(op);
  return id === undefined ? undefined : findRecord(lib, id)?.rev;
}

export function deleteRecord(lib: BibleLib, id: string): FoundRecord | undefined {
  if (id.startsWith("ledger:")) {
    const chapter = id.slice("ledger:".length);
    const entry = lib.ledgers.get(chapter);
    if (!entry) return undefined;
    lib.ledgers.delete(chapter);
    return { kind: "ledger", id, rev: 0, value: entry };
  }
  const take = <T extends { id: string; rev: number }>(list: T[]): T | undefined => {
    const index = list.findIndex((item) => item.id === id);
    return index === -1 ? undefined : list.splice(index, 1)[0];
  };
  const entity = take(lib.bible.entities);
  if (entity) return { kind: "entity", id, rev: 0, value: entity };
  const event = take(lib.bible.timeline);
  if (event) return { kind: "timeline", id, rev: 0, value: event };
  const thread = take(lib.bible.threads);
  if (thread) return { kind: "thread", id, rev: 0, value: thread };
  const row = take(lib.bible.knowledge);
  if (row) return { kind: "knowledge", id, rev: 0, value: row };
  const state = take(lib.bible.states);
  if (state) return { kind: "state", id, rev: 0, value: state };
  return undefined;
}

export function isBibleOp(op: AnyOp): op is BibleOp {
  return !(
    op.type === "node.create" ||
    op.type === "node.update" ||
    op.type === "node.delete" ||
    op.type === "node.move" ||
    op.type === "chapter.split" ||
    op.type === "chapter.merge" ||
    op.type === "act.split" ||
    op.type === "act.merge" ||
    op.type === "volume.split" ||
    op.type === "volume.merge" ||
    op.type === "chapter.bind" ||
    op.type === "chapter.unbind" ||
    op.type === "book.update"
  );
}
