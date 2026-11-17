/** 变更集提交、待确认批次提交与撤销。 */
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import type { IdSource } from "@zhizhang/core/id";
import { commitIntent, type Intent } from "@zhizhang/core/journal";
import type { LockService } from "@zhizhang/core/lock";
import { dropUndefined } from "@zhizhang/core/schema";
import { applyBibleOp, normalizeBible, validateBible, type ApplyResult } from "./apply.js";
import { PendingBatchSchema } from "./ops-schema.js";
import {
  applyRemovedLedgers,
  buildCommitWrites,
  findChangeSet,
  readChangeSets,
} from "./changeset.js";
import { invertOp } from "./invert.js";
import { currentRev, findRecord, isBibleOp, targetId } from "./ops.js";
import {
  indexRev,
  pendingFilePath,
  readIndex,
  readLib,
  readPendingBatch,
  type BibleLib,
  type SnapshotKey,
} from "./read.js";
import type {
  AnyOp,
  BibleIndex,
  BibleOp,
  ChangeSet,
  CommitResult,
  PendingBatch,
  PendingItem,
  RevertResult,
} from "./types.js";

const CREATE_TYPES = new Set([
  "entity.upsert",
  "state.add",
  "timeline.upsert",
  "thread.upsert",
  "knowledge.set",
  "ledger.write",
]);

interface CommitMeta {
  source: ChangeSet["source"];
  summary: string;
  batch?: string;
  run?: string;
}

function mergeRevs(target: Record<string, number>, source: Record<string, number>): void {
  for (const [id, rev] of Object.entries(source)) target[id] = rev;
}

function withEffectiveFrom(op: BibleOp, effectiveFrom: number | undefined): BibleOp {
  if (effectiveFrom === undefined) return op;
  if (op.type === "state.add") {
    return { ...op, entry: { ...op.entry, since: effectiveFrom } };
  }
  if (op.type === "state.update") {
    return { ...op, patch: { ...op.patch, since: effectiveFrom } };
  }
  return op;
}

function sortedBatch(batch: PendingBatch): PendingBatch["items"] {
  const accepted = new Map(
    batch.items
      .filter((item) => item.decision === "accept" || item.decision === "edit")
      .map((item) => [item.id, item]),
  );
  const indegree = new Map<string, number>();
  const followers = new Map<string, string[]>();
  for (const item of accepted.values()) {
    indegree.set(item.id, 0);
    followers.set(item.id, []);
  }
  for (const item of accepted.values()) {
    for (const dependency of item.dependsOn) {
      if (!accepted.has(dependency)) continue;
      indegree.set(item.id, (indegree.get(item.id) ?? 0) + 1);
      followers.get(dependency)?.push(item.id);
    }
  }
  const queue = [...accepted.values()]
    .filter((item) => (indegree.get(item.id) ?? 0) === 0)
    .map((item) => item.id);
  const out: PendingItem[] = [];
  while (queue.length > 0) {
    const id = queue[0];
    queue.shift();
    const item = accepted.get(id);
    if (!item) continue;
    out.push(item);
    for (const follower of followers.get(id) ?? []) {
      indegree.set(follower, (indegree.get(follower) ?? 0) - 1);
      if ((indegree.get(follower) ?? 0) === 0) queue.push(follower);
    }
  }
  if (out.length !== accepted.size) {
    throw new AppError("input.invalid", "待确认条目存在循环依赖", { rule: "dependency_cycle" });
  }
  return out;
}

async function writeChange(
  work: string,
  lock: LockService,
  lib: BibleLib,
  touched: Set<SnapshotKey>,
  ledgerChapters: Set<string>,
  change: ChangeSet,
  pending?: { file: string; after: string },
): Promise<void> {
  const built = await buildCommitWrites({
    work,
    lib,
    touched,
    ledgerChapters,
    change,
    ...(pending ? { pendingFile: pending.file, pendingAfter: pending.after } : {}),
  });
  change.files = built.files;
  const intent: Intent = {
    format: "zhizhang/1.3",
    id: change.id,
    writes: built.writes,
    meta: {
      kind: change.kind,
      source: change.source,
      ...(change.batch ? { batch: change.batch } : {}),
    },
  };
  await commitIntent(path.join(work, ".journal"), intent, lock, { kind: "work", path: work });
  await applyRemovedLedgers(built.removedLedgers);
}

export interface CommitDeps {
  lock: LockService;
  ids: IdSource;
  clock: Clock;
}

function newChange(
  deps: CommitDeps,
  meta: CommitMeta,
  ops: AnyOp[],
  inverse: AnyOp[],
  revs: Record<string, number>,
): ChangeSet {
  return {
    id: deps.ids.next("cs"),
    at: deps.clock.iso(),
    kind: "apply",
    source: meta.source,
    ...(meta.batch ? { batch: meta.batch } : {}),
    ...(meta.run ? { run: meta.run } : {}),
    summary: meta.summary.slice(0, 200),
    ops,
    inverse,
    revs,
    files: [],
  };
}

export async function commitApply(
  work: string,
  ops: BibleOp[],
  expectedRev: number,
  meta: CommitMeta,
  deps: CommitDeps,
): Promise<{ changeId: string }> {
  return deps.lock.write({ kind: "work", path: work }, async () => {
    const index = await readIndex(work);
    if (indexRev(index) !== expectedRev) {
      throw new AppError("storage.conflict", "设定集已被修改，请刷新后重试", {
        expectedRev,
        actualRev: indexRev(index),
      });
    }
    const lib = await readLib(work);
    const touched = new Set<SnapshotKey>();
    const ledgerChapters = new Set<string>();
    const inverse: AnyOp[] = [];
    const revs: Record<string, number> = {};
    for (const op of ops) {
      const inv = invertOp(lib, op);
      const applied: ApplyResult = applyBibleOp(lib, op);
      for (const key of applied.touched) touched.add(key);
      for (const chapter of applied.ledgerChapters) ledgerChapters.add(chapter);
      mergeRevs(revs, applied.revs);
      inverse.unshift(...inv);
    }
    validateBible(lib);
    normalizeBible(lib);
    const change = newChange(deps, meta, ops, inverse, revs);
    await writeChange(work, deps.lock, lib, touched, ledgerChapters, change);
    return { changeId: change.id };
  });
}

export async function commitBatch(
  work: string,
  batchId: string,
  _expectedRevs: BibleIndex["files"],
  deps: CommitDeps,
): Promise<CommitResult> {
  return deps.lock.write({ kind: "work", path: work }, async () => {
    const batch = await readPendingBatch(work, batchId);
    if (!batch) {
      throw new AppError("input.not_found", `未找到待确认批次：${batchId}`, { batch: batchId });
    }
    const items = sortedBatch(batch);
    if (items.length === 0) {
      throw new AppError("input.invalid", "没有已采纳的条目", { batch: batchId });
    }
    const lib = await readLib(work);
    const touched = new Set<SnapshotKey>();
    const ledgerChapters = new Set<string>();
    const ops: AnyOp[] = [];
    const inverse: AnyOp[] = [];
    const revs: Record<string, number> = {};
    const stale: string[] = [];
    const createdNow = new Set<string>();

    for (const item of items) {
      const raw = item.edited ?? item.op;
      if (!isBibleOp(raw)) {
        throw new AppError("internal", `未实现：D-01（${raw.type}）`);
      }
      const op = withEffectiveFrom(raw, item.effectiveFrom);
      const target = targetId(op);
      const current = currentRev(lib, op);
      if (item.baseRev !== undefined && current !== item.baseRev) {
        stale.push(item.id);
        continue;
      }
      // 无 baseRev 的 new 条目已存在时，说明此前已提交或被外部创建；同批次刚创建的记录除外。
      if (
        item.baseRev === undefined &&
        item.edited === undefined &&
        item.change === "new" &&
        current !== undefined &&
        (target === undefined || !createdNow.has(target))
      ) {
        stale.push(item.id);
        continue;
      }
      const inv = invertOp(lib, op);
      const applied = applyBibleOp(lib, op);
      for (const key of applied.touched) touched.add(key);
      for (const chapter of applied.ledgerChapters) ledgerChapters.add(chapter);
      mergeRevs(revs, applied.revs);
      if (target !== undefined && current === undefined) createdNow.add(target);
      ops.push(op);
      inverse.unshift(...inv);
    }

    validateBible(lib);
    normalizeBible(lib);
    const change = newChange(
      deps,
      {
        source: batch.source,
        batch: batch.id,
        ...(batch.run ? { run: batch.run } : {}),
        summary: `提交待确认 ${ops.length} 条（${batch.id}）`,
      },
      ops,
      inverse,
      revs,
    );

    batch.commits.push(change.id);
    batch.status = batch.items.every((item) => item.decision !== "undecided")
      ? "closed"
      : "partial";
    const pending = {
      file: pendingFilePath(work, batch.id),
      after: JSON.stringify(PendingBatchSchema(dropUndefined(batch)), null, 2),
    };
    await writeChange(work, deps.lock, lib, touched, ledgerChapters, change, pending);
    return { changeId: change.id, committed: ops.length, stale };
  });
}

export async function revertChange(
  work: string,
  changeId: string,
  force: boolean,
  deps: CommitDeps,
): Promise<RevertResult> {
  return deps.lock.write({ kind: "work", path: work }, async () => {
    const source = await findChangeSet(work, changeId);
    if (!source) {
      throw new AppError("input.not_found", `未找到变更集：${changeId}`, { changeId });
    }
    const lib = await readLib(work);
    const touched = new Set<SnapshotKey>();
    const ledgerChapters = new Set<string>();
    const appliedOps: AnyOp[] = [];
    const inverse: AnyOp[] = [];
    const revs: Record<string, number> = {};
    const skipped: RevertResult["skipped"] = [];
    const localRevs = new Map<string, number>();

    for (const op of source.inverse) {
      if (!isBibleOp(op)) {
        throw new AppError("internal", `未实现：D-01（${op.type}）`);
      }
      const id = targetId(op);
      const found = id ? findRecord(lib, id) : undefined;
      const expected = id ? (localRevs.get(id) ?? source.revs[id]) : undefined;
      if (op.type === "style.update") {
        // style 无条目 rev；直接恢复旧全文。
      } else if (!found) {
        if (!CREATE_TYPES.has(op.type)) {
          skipped.push({ target: id ?? op.type, reason: "missing" });
          continue;
        }
      } else if (!force && id && expected !== undefined && expected !== found.rev) {
        skipped.push({ target: id, reason: "rev_changed" });
        continue;
      }
      const inv = invertOp(lib, op);
      const applied = applyBibleOp(lib, op, {
        restore: true,
        allowAnyIdDelete: true,
      });
      for (const key of applied.touched) touched.add(key);
      for (const chapter of applied.ledgerChapters) ledgerChapters.add(chapter);
      mergeRevs(revs, applied.revs);
      for (const [key, rev] of Object.entries(applied.revs)) localRevs.set(key, rev);
      appliedOps.push(op);
      inverse.unshift(...inv);
    }

    if (appliedOps.length === 0) return { changeIds: [], skipped };
    validateBible(lib);
    normalizeBible(lib);
    const change: ChangeSet = {
      id: deps.ids.next("cs"),
      at: deps.clock.iso(),
      kind: "revert",
      reverts: source.id,
      source: "author",
      ...(source.batch ? { batch: source.batch } : {}),
      ...(source.run ? { run: source.run } : {}),
      summary: `撤销 ${source.id} 的 ${appliedOps.length} 项改动`.slice(0, 200),
      ops: appliedOps,
      inverse,
      revs,
      files: [],
    };
    await writeChange(work, deps.lock, lib, touched, ledgerChapters, change);
    return { changeIds: [change.id], skipped };
  });
}

export async function listChanges(
  work: string,
  before: string | undefined,
  limit: number,
  source?: ChangeSet["source"],
): Promise<Omit<ChangeSet, "ops" | "inverse">[]> {
  const all = await readChangeSets(work);
  const filtered = all.filter((change) => !source || change.source === source);
  const start = before ? filtered.findIndex((change) => change.id === before) : -1;
  const base = start >= 0 ? filtered.slice(0, start) : filtered;
  return base
    .slice(-Math.min(100, Math.max(1, limit)))
    .reverse()
    .map((change): Omit<ChangeSet, "ops" | "inverse"> => ({
      id: change.id,
      at: change.at,
      kind: change.kind,
      ...(change.reverts ? { reverts: change.reverts } : {}),
      source: change.source,
      ...(change.batch ? { batch: change.batch } : {}),
      ...(change.run ? { run: change.run } : {}),
      summary: change.summary,
      revs: change.revs,
      files: change.files,
    }));
}
