/** 每个 BibleOp 的逆操作：先基于当前真源计算，再应用原操作。 */
import { AppError } from "@zhizhang/core/errors";
import { applyBibleOp } from "./apply.js";
import { clone, findRecord, isBibleOp, ledgerTarget, type FoundRecord } from "./ops.js";
import type { BibleLib } from "./read.js";
import { invertStatePlan, planStateAdd } from "./state.js";
import type { AnyOp, BibleOp } from "./types.js";

function restoreRecord(lib: BibleLib, op: BibleOp): AnyOp[] {
  switch (op.type) {
    case "entity.upsert":
      return [{ type: "entity.upsert", entity: clone(op.entity) }];
    case "timeline.upsert":
      return [{ type: "timeline.upsert", event: clone(op.event) }];
    case "thread.upsert":
      return [{ type: "thread.upsert", thread: clone(op.thread) }];
    case "knowledge.set":
      return [{ type: "knowledge.set", row: clone(op.row) }];
    case "ledger.write":
      return [{ type: "ledger.write", entry: clone(op.entry) }];
    default:
      throw new AppError("internal", `不是可恢复记录：${op.type}`);
  }
}

function createdRecord(op: BibleOp, rev: number): AnyOp[] {
  const id = (() => {
    switch (op.type) {
      case "entity.upsert":
        return op.entity.id;
      case "timeline.upsert":
        return op.event.id;
      case "thread.upsert":
        return op.thread.id;
      case "knowledge.set":
        return op.row.id;
      case "ledger.write":
        return ledgerTarget(op.entry.chapter);
      default:
        throw new AppError("internal", `不是新建记录：${op.type}`);
    }
  })();
  return [{ type: "entity.delete", id, expectedRev: rev }];
}

function restoreFound(found: FoundRecord): AnyOp[] {
  if (found.kind === "entity") {
    return [{ type: "entity.upsert", entity: clone(found.value) }];
  }
  if (found.kind === "timeline") {
    return [{ type: "timeline.upsert", event: clone(found.value) }];
  }
  if (found.kind === "thread") {
    return [{ type: "thread.upsert", thread: clone(found.value) }];
  }
  if (found.kind === "knowledge") {
    return [{ type: "knowledge.set", row: clone(found.value) }];
  }
  if (found.kind === "state") {
    return [{ type: "state.add", entry: clone(found.value) }];
  }
  return [{ type: "ledger.write", entry: clone(found.value) }];
}

function invertMerge(lib: BibleLib, op: Extract<BibleOp, { type: "entity.merge" }>): AnyOp[] {
  const before = clone(lib);
  const after = clone(lib);
  applyBibleOp(after, op);
  const inverse: AnyOp[] = [];
  const keep = before.bible.entities.find((entity) => entity.id === op.keep);
  const drop = before.bible.entities.find((entity) => entity.id === op.drop);
  if (!keep || !drop) {
    throw new AppError("input.not_found", "合并实体不存在", { keep: op.keep, drop: op.drop });
  }
  inverse.push({ type: "entity.upsert", entity: keep });
  inverse.push({ type: "entity.upsert", entity: drop });

  const changed = <T extends { id: string; rev: number }>(from: T[], to: T[]): T[] => {
    const target = new Map(to.map((item) => [item.id, item]));
    return from.filter((item) => {
      const next = target.get(item.id);
      return !next || JSON.stringify(next) !== JSON.stringify(item);
    });
  };
  for (const entity of changed(before.bible.entities, after.bible.entities)) {
    if (entity.id !== keep.id && entity.id !== drop.id) {
      inverse.push({ type: "entity.upsert", entity });
    }
  }
  for (const state of changed(before.bible.states, after.bible.states)) {
    inverse.push({ type: "state.delete", id: state.id, expectedRev: state.rev + 1 });
    inverse.push({ type: "state.add", entry: state });
  }
  for (const event of changed(before.bible.timeline, after.bible.timeline)) {
    inverse.push({ type: "timeline.upsert", event });
  }
  for (const row of changed(before.bible.knowledge, after.bible.knowledge)) {
    inverse.push({ type: "knowledge.set", row });
  }
  for (const [chapter, entry] of before.ledgers) {
    if (JSON.stringify(entry) === JSON.stringify(after.ledgers.get(chapter))) continue;
    inverse.push({ type: "ledger.write", entry });
  }
  return inverse;
}

export function invertBibleOp(lib: BibleLib, op: BibleOp): AnyOp[] {
  switch (op.type) {
    case "entity.upsert": {
      const existing = lib.bible.entities.find((entity) => entity.id === op.entity.id);
      return existing
        ? restoreRecord(lib, { ...op, entity: existing })
        : createdRecord(op, op.entity.rev);
    }
    case "entity.merge":
      return invertMerge(lib, op);
    case "entity.delete": {
      const found = findRecord(lib, op.id);
      if (!found) {
        throw new AppError("input.not_found", `记录不存在：${op.id}`, { id: op.id });
      }
      if (found.kind !== "entity") return restoreFound(found);
      return [{ type: "entity.upsert", entity: clone(found.value) }];
    }
    case "timeline.upsert": {
      const existing = lib.bible.timeline.find((event) => event.id === op.event.id);
      return existing
        ? restoreRecord(lib, { ...op, event: existing })
        : createdRecord(op, op.event.rev);
    }
    case "state.add":
      return invertStatePlan(planStateAdd(lib.bible.states, op.entry));
    case "state.update": {
      const existing = lib.bible.states.find((entry) => entry.id === op.id);
      if (!existing) {
        throw new AppError("input.not_found", `状态不存在：${op.id}`, { id: op.id });
      }
      return [
        { type: "state.delete", id: existing.id, expectedRev: existing.rev + 1 },
        { type: "state.add", entry: clone(existing) },
      ];
    }
    case "state.delete": {
      const existing = lib.bible.states.find((entry) => entry.id === op.id);
      if (!existing) {
        throw new AppError("input.not_found", `状态不存在：${op.id}`, { id: op.id });
      }
      return [{ type: "state.add", entry: clone(existing) }];
    }
    case "thread.upsert": {
      const existing = lib.bible.threads.find((thread) => thread.id === op.thread.id);
      return existing
        ? restoreRecord(lib, { ...op, thread: existing })
        : createdRecord(op, op.thread.rev);
    }
    case "thread.beat": {
      const existing = lib.bible.threads.find((thread) => thread.id === op.thread);
      if (!existing) {
        throw new AppError("input.not_found", `线索不存在：${op.thread}`, { id: op.thread });
      }
      return [{ type: "thread.upsert", thread: clone(existing) }];
    }
    case "knowledge.set": {
      const existing = lib.bible.knowledge.find((row) => row.id === op.row.id);
      return existing
        ? restoreRecord(lib, { ...op, row: existing })
        : createdRecord(op, op.row.rev);
    }
    case "ledger.write": {
      const existing = lib.ledgers.get(op.entry.chapter);
      return existing
        ? restoreRecord(lib, { ...op, entry: existing })
        : createdRecord(op, op.entry.rev);
    }
    case "style.update":
      return [{ type: "style.update", patch: clone(lib.bible.style) }];
    default: {
      const exhaustive: never = op;
      throw new AppError("internal", `未实现的逆操作：${String(exhaustive)}`);
    }
  }
}

export function invertOp(lib: BibleLib, op: AnyOp): AnyOp[] {
  if (!isBibleOp(op)) {
    throw new AppError("internal", `未实现：D-01（${op.type}）`);
  }
  return invertBibleOp(lib, op);
}
