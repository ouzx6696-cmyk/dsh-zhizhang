/** 待确认批次：propose 只写批次，decide 只改决定。 */
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite } from "@zhizhang/core/fs";
import type { IdSource } from "@zhizhang/core/id";
import type { LockService } from "@zhizhang/core/lock";
import { dropUndefined } from "@zhizhang/core/schema";
import { PendingBatchSchema } from "./ops-schema.js";
import { findRecord, isBibleOp, targetId } from "./ops.js";
import { pendingFilePath, readLib, readPendingBatch, type BibleLib } from "./read.js";
import { sameValue, stateKey } from "./interval.js";
import type {
  AnyOp,
  BibleOp,
  Evidence,
  PendingBatch,
  PendingItem,
  PendingSource,
  SourceRef,
} from "./types.js";

const SOURCE_PREFIX: Record<PendingSource, string> = {
  import: "imp",
  ledger: "led",
  plan: "pln",
  assistant: "asst",
};

export interface ProposeOpMeta {
  evidence?: Evidence;
  located?: boolean;
  change?: PendingItem["change"];
  group?: string;
  dependsOn?: string[];
  notes?: string[];
  src?: SourceRef[];
  confidence?: PendingItem["confidence"];
  baseRev?: number;
}

export interface ProposeInput {
  source: string;
  run?: string;
  chapter?: number;
  reason?: string;
  at: string;
}

function sourceOf(source: string): PendingSource {
  return source === "import" || source === "ledger" || source === "plan" ? source : "assistant";
}

function opEvidence(op: BibleOp): Evidence | undefined {
  if (op.type === "state.add") return op.entry.evidence;
  if (op.type === "knowledge.set") return op.row.evidence;
  if (op.type === "thread.upsert") return op.thread.beats[0]?.evidence;
  return undefined;
}

function conflictOf(lib: BibleLib, op: BibleOp): string | undefined {
  if (op.type === "state.add") {
    const conflict = lib.bible.states.find(
      (state) =>
        stateKey(state) === stateKey(op.entry) &&
        state.value !== op.entry.value &&
        (state.mode === "replace" || op.entry.mode === "replace") &&
        state.since < (op.entry.until ?? Number.POSITIVE_INFINITY) &&
        op.entry.since < (state.until ?? Number.POSITIVE_INFINITY),
    );
    return conflict?.id;
  }
  if (op.type === "entity.upsert") {
    const existing = lib.bible.entities.find((entity) => entity.id === op.entity.id);
    return existing?.locked.length ? existing.id : undefined;
  }
  if (op.type === "thread.upsert") {
    const existing = lib.bible.threads.find(
      (thread) =>
        thread.id === op.thread.id && thread.status === "paid" && op.thread.status === "open",
    );
    return existing?.id;
  }
  return undefined;
}

function payload(op: BibleOp): object | undefined {
  if (op.type === "entity.upsert") return op.entity;
  if (op.type === "timeline.upsert") return op.event;
  if (op.type === "state.add") return op.entry;
  if (op.type === "thread.upsert") return op.thread;
  if (op.type === "knowledge.set") return op.row;
  return undefined;
}

function diffOf(
  before: object | undefined,
  after: object | undefined,
): PendingItem["diff"] | undefined {
  if (!before || !after) return undefined;
  const diff: NonNullable<PendingItem["diff"]> = [];
  for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (field === "rev" || field === "provenance") continue;
    const prev = Reflect.get(before, field);
    const next = Reflect.get(after, field);
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      diff.push({ field, before: prev, after: next });
    }
  }
  return diff.length > 0 ? diff : undefined;
}

const CREATE_OPS = new Set([
  "entity.upsert",
  "timeline.upsert",
  "state.add",
  "thread.upsert",
  "knowledge.set",
  "ledger.write",
]);

function entityRefs(op: BibleOp): string[] {
  switch (op.type) {
    case "entity.upsert":
      return [op.entity.parent, ...(op.entity.related ?? [])].filter(
        (id): id is string => id !== undefined,
      );
    case "entity.merge":
      return [op.keep, op.drop];
    case "timeline.upsert":
      return op.event.entities;
    case "state.add":
      return op.entry.target === undefined ? [op.entry.entity] : [op.entry.entity, op.entry.target];
    case "knowledge.set":
      return [op.row.holder];
    case "ledger.write":
      return [
        ...op.entry.appearances.map((appearance) => appearance.entity),
        ...op.entry.facts.flatMap((fact) => fact.entities),
        ...Object.keys(op.entry.handoff.positions),
      ];
    default:
      return [];
  }
}

function classify(lib: BibleLib, op: BibleOp, conflict: string | undefined): PendingItem["change"] {
  if (conflict) return "conflict";
  if (op.type === "state.add") {
    const existing = lib.bible.states.find(
      (state) => stateKey(state) === stateKey(op.entry) && state.since === op.entry.since,
    );
    if (existing) {
      if (sameValue(existing.value, op.entry.value)) {
        return existing.status === "planned" && op.entry.status === "confirmed"
          ? "fulfill"
          : "same";
      }
      return "update";
    }
    return "new";
  }
  if (isBibleOp(op)) {
    const id = targetId(op);
    const found = id ? findRecord(lib, id) : undefined;
    return found ? "update" : "new";
  }
  return "new";
}

export async function proposeBatch(
  work: string,
  ops: BibleOp[],
  input: ProposeInput,
  metaList: ProposeOpMeta[] | undefined,
  deps: { lock: LockService; ids: IdSource },
): Promise<PendingItem[]> {
  return deps.lock.write({ kind: "work", path: work }, async () => {
    const lib = await readLib(work);
    const source = sourceOf(input.source);
    const batchId = deps.ids.next(SOURCE_PREFIX[source]);
    const itemIds = ops.map(() => deps.ids.next("p"));
    const created = new Map<string, string>();
    ops.forEach((op, index) => {
      if (!CREATE_OPS.has(op.type)) return;
      const id = targetId(op);
      if (id && !findRecord(lib, id)) created.set(id, itemIds[index]);
    });
    const items: PendingItem[] = ops.map((op, index) => {
      const meta = metaList?.[index] ?? {};
      const conflict = conflictOf(lib, op);
      const id = targetId(op);
      const found = id ? findRecord(lib, id) : undefined;
      const baseRev = meta.baseRev ?? found?.rev;
      const payloadAfter = payload(op);
      const payloadBefore =
        found && typeof found.value === "object" && found.value !== null ? found.value : undefined;
      const diff = diffOf(payloadBefore, payloadAfter);
      const notes = conflict ? ["bible.conflict_with", conflict] : [];
      notes.push(...(meta.notes ?? []));
      const dependsOn = [...(meta.dependsOn ?? [])];
      const addDependency = (creator: string | undefined): void => {
        if (!creator || creator === itemIds[index] || dependsOn.includes(creator)) return;
        dependsOn.push(creator);
      };
      if (id) addDependency(created.get(id));
      for (const ref of entityRefs(op)) addDependency(created.get(ref));
      const item: PendingItem = {
        id: itemIds[index],
        op,
        change: meta.change ?? classify(lib, op, conflict),
        ...(diff ? { diff } : {}),
        ...(meta.confidence ? { confidence: meta.confidence } : {}),
        ...(meta.src ? { src: meta.src } : {}),
        ...(meta.evidence || opEvidence(op) ? { evidence: meta.evidence ?? opEvidence(op) } : {}),
        group: meta.group ?? "default",
        dependsOn,
        notes,
        ...(baseRev !== undefined ? { baseRev } : {}),
        decision: "undecided",
      };
      return item;
    });
    const batch: PendingBatch = {
      format: "zhizhang/1.3",
      id: batchId,
      source,
      ...(input.run ? { run: input.run } : {}),
      ...(input.chapter ? { chapter: input.chapter } : {}),
      ...(input.reason ? { reason: input.reason } : {}),
      created: input.at,
      status: "open",
      items,
      commits: [],
    };
    await pathWrite(work, batch);
    return items;
  });
}

async function pathWrite(work: string, batch: PendingBatch): Promise<void> {
  const checked = PendingBatchSchema(dropUndefined(batch));
  await atomicWrite(pendingFilePath(work, batch.id), JSON.stringify(checked, null, 2));
}

export interface PendingDecision {
  id: string;
  decision: "accept" | "reject" | "edit";
  edited?: AnyOp;
  effectiveFrom?: number;
}

export async function decideBatch(
  work: string,
  batchId: string,
  decisions: PendingDecision[],
  lock: LockService,
): Promise<{ decided: number }> {
  return lock.write({ kind: "work", path: work }, async () => {
    const batch = await readPendingBatch(work, batchId);
    if (!batch) {
      throw new AppError("input.not_found", `未找到待确认批次：${batchId}`, { batch: batchId });
    }
    for (const decision of decisions) {
      const item = batch.items.find((entry) => entry.id === decision.id);
      if (!item) {
        throw new AppError("input.not_found", `未找到待确认条目：${decision.id}`, {
          id: decision.id,
        });
      }
      if (decision.decision === "edit") {
        if (!decision.edited) {
          throw new AppError("input.invalid", "edit 必须提供 edited", {
            path: "$.decisions.edited",
          });
        }
        item.edited = decision.edited;
      } else if (item.edited !== undefined) {
        delete item.edited;
      }
      item.decision = decision.decision;
      if (decision.effectiveFrom !== undefined) item.effectiveFrom = decision.effectiveFrom;
    }
    batch.status = batch.items.some((item) => item.decision === "undecided")
      ? batch.items.some((item) => item.decision !== "undecided")
        ? "partial"
        : "open"
      : "closed";
    const file = pendingFilePath(work, batch.id);
    await atomicWrite(file, JSON.stringify(PendingBatchSchema(dropUndefined(batch)), null, 2));
    return { decided: decisions.length };
  });
}
