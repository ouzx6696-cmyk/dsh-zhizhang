import { systemClock } from "@zhizhang/core/clock";
import { createLockService } from "@zhizhang/core/lock";
import { createBibleStore } from "../bible/store.js";
export async function readBible(workPath, lock = createLockService(systemClock)) {
    return createBibleStore(lock).read(workPath);
}
export async function viewBibleAt(workPath, position, lock = createLockService(systemClock)) {
    const store = createBibleStore(lock);
    const bible = await store.read(workPath);
    return store.asOf(bible, position);
}
export async function proposeBibleOps(workPath, ops, from, lock = createLockService(systemClock)) {
    return createBibleStore(lock).propose(workPath, ops, from);
}
export async function decideBiblePending(workPath, id, decision, lock = createLockService(systemClock)) {
    return createBibleStore(lock).decide(workPath, id, decision);
}
export async function auditBible(workPath, upTo, lock = createLockService(systemClock)) {
    const store = createBibleStore(lock);
    const bible = await store.read(workPath);
    return store.audit(bible, upTo);
}
