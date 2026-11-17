/** BibleOp 应用与 V2 不变量校验。 */
import { AppError } from "@zhizhang/core/errors";
import { replacesOverlap } from "./interval.js";
import { clone, deleteRecord, findRecord, ledgerTarget, type RecordKind } from "./ops.js";
import type { BibleLib, SnapshotKey } from "./read.js";
import { applyStatePlan, planStateAdd } from "./state.js";
import type { BibleOp, Entity } from "./types.js";

export interface ApplyOptions {
  /** 撤销/重放逆操作时按 op 携带的 rev 原样恢复。 */
  restore?: boolean;
  /** 逆操作载体 entity.delete 可按 id 删除任意集合。 */
  allowAnyIdDelete?: boolean;
}

export interface ApplyResult {
  touched: Set<SnapshotKey>;
  ledgerChapters: Set<string>;
  revs: Record<string, number>;
}

function snapshotKey(kind: RecordKind): SnapshotKey | undefined {
  if (kind === "entity") return "entities";
  if (kind === "timeline") return "timeline";
  if (kind === "thread") return "threads";
  if (kind === "knowledge") return "knowledge";
  if (kind === "state") return "states";
  return undefined;
}

function note(result: ApplyResult, kind: RecordKind, id: string, rev: number): void {
  const key = snapshotKey(kind);
  if (key) result.touched.add(key);
  result.revs[id] = rev;
}

function conflict(op: string, id: string, expected: number, actual: number | undefined): never {
  throw new AppError("storage.conflict", `版本冲突：${id}`, {
    path: `$.ops.${op}`,
    id,
    expectedRev: expected,
    actualRev: actual ?? null,
  });
}

function upsert<T extends { id: string; rev: number }>(
  list: T[],
  value: T,
  expectedRev: number | undefined,
  restore: boolean,
): { created: boolean; postRev: number } {
  const index = list.findIndex((item) => item.id === value.id);
  if (index === -1) {
    const next = clone(value);
    list.push(next);
    return { created: true, postRev: next.rev };
  }
  const existing = list[index];
  if (!restore && expectedRev !== undefined && existing.rev !== expectedRev) {
    conflict("upsert", value.id, expectedRev, existing.rev);
  }
  const next = clone(value);
  next.rev = restore ? value.rev : existing.rev + 1;
  list[index] = next;
  return { created: false, postRev: next.rev };
}

function mergeEntity(lib: BibleLib, keepId: string, dropId: string, result: ApplyResult): void {
  if (keepId === dropId) {
    throw new AppError("input.invalid", "实体不能与自身合并", {
      path: "$.ops.entity.merge",
      rule: "same_entity",
    });
  }
  const keep = lib.bible.entities.find((entity) => entity.id === keepId);
  const drop = lib.bible.entities.find((entity) => entity.id === dropId);
  if (!keep || !drop) {
    throw new AppError("input.not_found", `实体不存在：${!keep ? keepId : dropId}`, {
      keep: keepId,
      drop: dropId,
    });
  }
  keep.aliases = [...new Set([...keep.aliases, drop.name, ...drop.aliases])].filter(
    (alias) => alias !== keep.name,
  );
  keep.rev += 1;
  note(result, "entity", keep.id, keep.rev);

  const reparent = (entity: Entity) => {
    if (entity.parent === dropId) entity.parent = keepId;
    if (entity.related?.includes(dropId)) {
      entity.related = [...new Set(entity.related.map((id) => (id === dropId ? keepId : id)))];
    }
  };
  for (const entity of lib.bible.entities) {
    if (entity.id === dropId) continue;
    const before = JSON.stringify(entity);
    reparent(entity);
    if (JSON.stringify(entity) !== before) {
      entity.rev += 1;
      note(result, "entity", entity.id, entity.rev);
    }
  }

  for (const state of lib.bible.states) {
    const before = `${state.entity}\u0000${state.target ?? ""}`;
    if (state.entity === dropId) state.entity = keepId;
    if (state.target === dropId) state.target = keepId;
    if (`${state.entity}\u0000${state.target ?? ""}` !== before) {
      state.rev += 1;
      note(result, "state", state.id, state.rev);
    }
  }
  for (const event of lib.bible.timeline) {
    if (!event.entities.includes(dropId)) continue;
    event.entities = [...new Set(event.entities.map((id) => (id === dropId ? keepId : id)))];
    event.rev += 1;
    note(result, "timeline", event.id, event.rev);
  }
  for (const row of lib.bible.knowledge) {
    if (row.holder !== dropId) continue;
    row.holder = keepId;
    row.rev += 1;
    note(result, "knowledge", row.id, row.rev);
  }

  for (const [chapter, entry] of lib.ledgers) {
    const before = JSON.stringify(entry);
    const appearances = new Map<string, number>();
    for (const appearance of entry.appearances) {
      const id = appearance.entity === dropId ? keepId : appearance.entity;
      appearances.set(id, (appearances.get(id) ?? 0) + appearance.count);
    }
    if (entry.appearances.some((appearance) => appearance.entity === dropId)) {
      entry.appearances = [...appearances].map(([entity, count]) => ({ entity, count }));
    }
    for (const fact of entry.facts) {
      if (!fact.entities.includes(dropId)) continue;
      fact.entities = [...new Set(fact.entities.map((id) => (id === dropId ? keepId : id)))];
    }
    const positions = entry.handoff.positions;
    if (dropId in positions) {
      const next: Record<string, string> = {};
      const hasKeep = keepId in positions;
      for (const [key, value] of Object.entries(positions)) {
        if (key === dropId) {
          if (!hasKeep) next[keepId] = value;
        } else {
          next[key] = value;
        }
      }
      entry.handoff.positions = next;
    }
    if (JSON.stringify(entry) === before) continue;
    entry.rev += 1;
    result.revs[ledgerTarget(chapter)] = entry.rev;
    result.ledgerChapters.add(chapter);
  }

  lib.bible.entities = lib.bible.entities.filter((entity) => entity.id !== dropId);
  result.revs[dropId] = 0;
}
export function applyBibleOp(lib: BibleLib, op: BibleOp, options: ApplyOptions = {}): ApplyResult {
  const result: ApplyResult = { touched: new Set(), ledgerChapters: new Set(), revs: {} };
  const restore = options.restore === true;
  switch (op.type) {
    case "entity.upsert": {
      const applied = upsert(lib.bible.entities, op.entity, op.expectedRev, restore);
      note(result, "entity", op.entity.id, applied.postRev);
      return result;
    }
    case "entity.merge": {
      mergeEntity(lib, op.keep, op.drop, result);
      return result;
    }
    case "entity.delete": {
      if (options.allowAnyIdDelete && restore) {
        const found = deleteRecord(lib, op.id);
        if (!found) {
          throw new AppError("input.not_found", `记录不存在：${op.id}`, { id: op.id });
        }
        note(result, found.kind, op.id, 0);
        if (found.kind === "ledger") result.ledgerChapters.add(op.id.slice(7));
        return result;
      }
      const scoped = findRecord(lib, op.id);
      if (!scoped || scoped.kind !== "entity") {
        throw new AppError("input.not_found", `实体不存在：${op.id}`, { id: op.id });
      }
      if (!restore && scoped.rev !== op.expectedRev) {
        conflict("entity.delete", op.id, op.expectedRev, scoped.rev);
      }
      deleteRecord(lib, op.id);
      note(result, "entity", op.id, 0);
      return result;
    }
    case "timeline.upsert": {
      const applied = upsert(lib.bible.timeline, op.event, op.expectedRev, restore);
      note(result, "timeline", op.event.id, applied.postRev);
      return result;
    }
    case "state.add": {
      const plan = planStateAdd(lib.bible.states, op.entry);
      applyStatePlan(lib.bible.states, plan);
      result.touched.add("states");
      for (const change of plan.changes) result.revs[change.before.id] = change.after.rev;
      result.revs[plan.entry.id] = plan.entry.rev;
      return result;
    }
    case "state.update": {
      const state = lib.bible.states.find((entry) => entry.id === op.id);
      if (!state) {
        throw new AppError("input.not_found", `状态不存在：${op.id}`, { id: op.id });
      }
      if (!restore && state.rev !== op.expectedRev) {
        conflict("state.update", op.id, op.expectedRev, state.rev);
      }
      if (op.patch.value !== undefined) state.value = op.patch.value;
      if (op.patch.since !== undefined) state.since = op.patch.since;
      if (op.patch.until !== undefined) state.until = op.patch.until;
      if (op.patch.status !== undefined) state.status = op.patch.status;
      if (op.patch.evidence !== undefined) state.evidence = clone(op.patch.evidence);
      state.rev = restore ? state.rev : state.rev + 1;
      note(result, "state", op.id, state.rev);
      return result;
    }
    case "state.delete": {
      const index = lib.bible.states.findIndex((entry) => entry.id === op.id);
      if (index === -1) {
        throw new AppError("input.not_found", `状态不存在：${op.id}`, { id: op.id });
      }
      if (!restore && lib.bible.states[index].rev !== op.expectedRev) {
        conflict("state.delete", op.id, op.expectedRev, lib.bible.states[index].rev);
      }
      lib.bible.states.splice(index, 1);
      note(result, "state", op.id, 0);
      return result;
    }
    case "thread.upsert": {
      const applied = upsert(lib.bible.threads, op.thread, op.expectedRev, restore);
      note(result, "thread", op.thread.id, applied.postRev);
      return result;
    }
    case "thread.beat": {
      const thread = lib.bible.threads.find((entry) => entry.id === op.thread);
      if (!thread) {
        throw new AppError("input.not_found", `线索不存在：${op.thread}`, { id: op.thread });
      }
      thread.beats.push(clone(op.beat));
      if (op.close) thread.status = op.close;
      thread.rev = restore ? thread.rev : thread.rev + 1;
      note(result, "thread", thread.id, thread.rev);
      return result;
    }
    case "knowledge.set": {
      const applied = upsert(lib.bible.knowledge, op.row, op.expectedRev, restore);
      note(result, "knowledge", op.row.id, applied.postRev);
      return result;
    }
    case "ledger.write": {
      const chapter = op.entry.chapter;
      const existing = lib.ledgers.get(chapter);
      if (!restore && existing && existing.rev !== op.entry.rev) {
        conflict("ledger.write", ledgerTarget(chapter), op.entry.rev, existing.rev);
      }
      const entry = clone(op.entry);
      entry.rev = restore ? op.entry.rev : (existing?.rev ?? -1) + 1;
      lib.ledgers.set(chapter, entry);
      result.ledgerChapters.add(chapter);
      result.revs[ledgerTarget(chapter)] = entry.rev;
      return result;
    }
    case "style.update": {
      if (op.patch.contract !== undefined) lib.bible.style.contract = op.patch.contract;
      if (op.patch.rules !== undefined) lib.bible.style.rules = clone(op.patch.rules);
      if (op.patch.voiceSamples !== undefined) {
        lib.bible.style.voiceSamples = [...op.patch.voiceSamples];
      }
      result.touched.add("style");
      return result;
    }
    default: {
      const exhaustive: never = op;
      throw new AppError("internal", `未实现的设定集操作：${String(exhaustive)}`);
    }
  }
}

function ensureUnique(kind: string, list: { id: string }[]): void {
  const seen = new Set<string>();
  for (const item of list) {
    if (seen.has(item.id)) {
      throw new AppError("input.invalid", `${kind} id 重复：${item.id}`, {
        path: `$.${kind}`,
        rule: "duplicate_id",
        id: item.id,
      });
    }
    seen.add(item.id);
  }
}

/** V2 全量校验；失败时调用方尚未写盘。 */
export function validateBible(lib: BibleLib): void {
  ensureUnique("entities", lib.bible.entities);
  ensureUnique("timeline", lib.bible.timeline);
  ensureUnique("states", lib.bible.states);
  ensureUnique("threads", lib.bible.threads);
  ensureUnique("knowledge", lib.bible.knowledge);
  const entityIds = new Set(lib.bible.entities.map((entity) => entity.id));
  const requireEntity = (id: string, path: string): void => {
    if (entityIds.has(id)) return;
    throw new AppError("input.invalid", `引用不存在的实体：${id}`, {
      path,
      rule: "dangling_ref",
      id,
    });
  };
  for (const entity of lib.bible.entities) {
    if (entity.parent !== undefined) {
      requireEntity(entity.parent, `$.entities.${entity.id}.parent`);
    }
    for (const [index, related] of (entity.related ?? []).entries()) {
      requireEntity(related, `$.entities.${entity.id}.related.${index}`);
    }
  }
  for (const state of lib.bible.states) {
    requireEntity(state.entity, `$.states.${state.id}.entity`);
    if (state.target !== undefined) {
      requireEntity(state.target, `$.states.${state.id}.target`);
    }
  }
  for (const event of lib.bible.timeline) {
    for (const [index, id] of event.entities.entries()) {
      requireEntity(id, `$.timeline.${event.id}.entities.${index}`);
    }
  }
  for (const row of lib.bible.knowledge) {
    requireEntity(row.holder, `$.knowledge.${row.id}.holder`);
  }
  for (const [chapter, entry] of lib.ledgers) {
    for (const [index, appearance] of entry.appearances.entries()) {
      requireEntity(appearance.entity, `$.ledger.${chapter}.appearances.${index}.entity`);
    }
    for (const [factIndex, fact] of entry.facts.entries()) {
      for (const [index, id] of fact.entities.entries()) {
        requireEntity(id, `$.ledger.${chapter}.facts.${factIndex}.entities.${index}`);
      }
    }
    for (const id of Object.keys(entry.handoff.positions)) {
      requireEntity(id, `$.ledger.${chapter}.handoff.positions.${id}`);
    }
  }

  for (const state of lib.bible.states) {
    if (state.until !== undefined && state.until <= state.since) {
      throw new AppError("input.invalid", `状态区间为空：${state.id}`, {
        path: `$.states.${state.id}`,
        rule: "until_le_since",
      });
    }
  }
  const overlap = replacesOverlap(lib.bible.states)[0];
  if (overlap) {
    throw new AppError("input.invalid", `状态区间重叠：${overlap[0].id} / ${overlap[1].id}`, {
      path: `$.states.${overlap[1].id}`,
      rule: "state_overlap",
      ids: [overlap[0].id, overlap[1].id],
    });
  }

  for (const thread of lib.bible.threads) {
    if (
      thread.plannedPlant !== undefined &&
      thread.plannedPayoff !== undefined &&
      thread.plannedPlant >= thread.plannedPayoff
    ) {
      throw new AppError("input.invalid", `线索埋设位置不早于兑现：${thread.id}`, {
        path: `$.threads.${thread.id}`,
        rule: "plant_after_payoff",
      });
    }
  }

  ensureUnique(
    "style.rules",
    lib.bible.style.rules.map((rule) => ({ id: rule.id })),
  );
  ensureUnique(
    "ledgers",
    [...lib.ledgers.values()].map((entry) => ({ id: entry.chapter })),
  );
}

export function normalizeBible(lib: BibleLib): void {
  lib.bible.states = [...lib.bible.states].sort(
    (a, b) => a.since - b.since || a.id.localeCompare(b.id),
  );
}
