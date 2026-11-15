import { systemClock } from "@zhizhang/core/clock";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { createBibleStore } from "../bible/store.js";
import type {
  AuditFinding,
  Bible,
  BibleOp,
  BibleView,
  PendingItem,
  Provenance,
} from "../bible/types.js";

export async function readBible(
  workPath: string,
  lock: LockService = createLockService(systemClock)
): Promise<Bible> {
  return createBibleStore(lock).read(workPath);
}

export async function viewBibleAt(
  workPath: string,
  position: number,
  lock: LockService = createLockService(systemClock)
): Promise<BibleView> {
  const store = createBibleStore(lock);
  const bible = await store.read(workPath);
  return store.asOf(bible, position);
}

export async function proposeBibleOps(
  workPath: string,
  ops: BibleOp[],
  from: Provenance,
  lock: LockService = createLockService(systemClock)
): Promise<PendingItem[]> {
  return createBibleStore(lock).propose(workPath, ops, from);
}

export async function decideBiblePending(
  workPath: string,
  id: string,
  decision: "accept" | "reject" | { edit: BibleOp },
  lock: LockService = createLockService(systemClock)
): Promise<void> {
  return createBibleStore(lock).decide(workPath, id, decision);
}

export async function auditBible(
  workPath: string,
  upTo: number,
  lock: LockService = createLockService(systemClock)
): Promise<AuditFinding[]> {
  const store = createBibleStore(lock);
  const bible = await store.read(workPath);
  return store.audit(bible, upTo);
}
