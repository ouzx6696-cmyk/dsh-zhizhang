import { systemClock } from "@zhizhang/core/clock";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { createBibleStore, type ProposeOpMeta } from "../bible/store.js";
import type { BibleFilter, PageInput } from "../bible/query.js";
import type {
  AuditFinding,
  BibleIndex,
  BibleOp,
  BibleSnapshot,
  BibleView,
  ChangeSet,
  CommitResult,
  PendingBatch,
  PendingItem,
  Provenance,
  RevertResult,
} from "../bible/types.js";
import type { PendingDecision } from "../bible/pending.js";

export async function readBible(
  workPath: string,
  lock: LockService = createLockService(systemClock),
): Promise<BibleSnapshot> {
  return createBibleStore(lock).read(workPath);
}

export async function viewBibleAt(
  workPath: string,
  position: number,
  lock: LockService = createLockService(systemClock),
): Promise<BibleView> {
  const store = createBibleStore(lock);
  const bible = await store.read(workPath);
  return store.asOf(bible, position, await store.ledgers(workPath));
}

export async function proposeBibleOps(
  workPath: string,
  ops: BibleOp[],
  from: Provenance,
  lock: LockService = createLockService(systemClock),
  metaList?: ProposeOpMeta[],
): Promise<PendingItem[]> {
  return createBibleStore(lock).propose(workPath, ops, from, metaList);
}

export async function decideBibleBatch(
  workPath: string,
  batch: string,
  decisions: PendingDecision[],
  lock: LockService = createLockService(systemClock),
): Promise<{ decided: number }> {
  return createBibleStore(lock).decide(workPath, batch, decisions);
}

export async function commitBibleBatch(
  workPath: string,
  batch: string,
  expectedRevs: BibleIndex["files"],
  lock: LockService = createLockService(systemClock),
): Promise<CommitResult> {
  return createBibleStore(lock).commit(workPath, batch, expectedRevs);
}

export async function applyBibleOps(
  workPath: string,
  ops: BibleOp[],
  expectedRev: number,
  lock: LockService = createLockService(systemClock),
): Promise<{ changeId: string }> {
  return createBibleStore(lock).apply(workPath, ops, expectedRev);
}

export async function revertBibleChange(
  workPath: string,
  changeId: string,
  force: boolean,
  lock: LockService = createLockService(systemClock),
): Promise<RevertResult> {
  return createBibleStore(lock).revert(workPath, changeId, force);
}

export async function listBibleChanges(
  workPath: string,
  before: string | undefined,
  limit: number,
  source?: ChangeSet["source"],
  lock: LockService = createLockService(systemClock),
): Promise<Omit<ChangeSet, "ops" | "inverse">[]> {
  return createBibleStore(lock).changes(workPath, before, limit, source);
}

export async function queryBible(
  workPath: string,
  filter: BibleFilter,
  position: number | undefined,
  page: PageInput,
  lock: LockService = createLockService(systemClock),
) {
  return createBibleStore(lock).query(workPath, filter, position, page);
}

export async function entityBible(
  workPath: string,
  id: string,
  position?: number,
  lock: LockService = createLockService(systemClock),
) {
  return createBibleStore(lock).entity(workPath, id, position);
}

export async function listPendingBatches(
  workPath: string,
  lock: LockService = createLockService(systemClock),
): Promise<PendingBatch[]> {
  return createBibleStore(lock).readPendingBatches(workPath);
}

export async function readPendingBatch(
  workPath: string,
  batch: string,
  lock: LockService = createLockService(systemClock),
): Promise<PendingBatch | undefined> {
  return createBibleStore(lock).readPendingBatch(workPath, batch);
}

export async function auditBible(
  workPath: string,
  upTo: number,
  lock: LockService = createLockService(systemClock),
): Promise<AuditFinding[]> {
  const store = createBibleStore(lock);
  const bible = await store.read(workPath);
  return store.audit(bible, upTo, await store.ledgers(workPath));
}
