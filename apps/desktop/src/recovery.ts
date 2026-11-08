import { errorText } from "../../../packages/core/src/errors.js";
/**
 * Desktop recovery reuses the existing journals. A write lock is cleared only when its owner
 * is provably gone, after the author confirmed, and always before the backup is taken.
 */
import path from "node:path";
import { readdir } from "node:fs/promises";
import { workspaceAccess } from "../../../packages/core/src/workspace-lock";
import {
  inspectPendingChapterSave,
  resumePendingChapterSave,
} from "../../../packages/fanqie/src/engine/storage/chapter-journal";
import {
  inspectPendingAccept,
  resumePendingAccept,
} from "../../../packages/fanqie/src/engine/storage/accept-journal";
import { snapshotFile } from "../../../packages/fanqie/src/engine/storage/journal";
import {
  clearWriteLock,
  ensureRecoveryOwnerInactive,
  inspectWriteLock,
} from "../../../packages/fanqie/src/engine/storage/process-lock";

const CHAPTER = ".writer-chapter-pending.json";
const ACCEPT = ".writer-accept-pending.json";
export async function inspectRecovery(dir: string) {
  const entries = await readdir(dir);
  const lease = await workspaceAccess(dir);
  const pending = entries.filter((name) => /^\.writer-.*pending.*\.json$/.test(name));
  let reason = lease.readOnly ? `作品由 ${lease.owner.host} 占用，请先关闭另一处写入。` : "";
  const lock = await inspectWriteLock(dir);
  if (lock.state === "active" || lock.state === "unknown")
    reason ||= `作品有写入锁（${lock.reason}），请先停止写入并核对锁状态；此处不会清锁。`;
  const staleLock = lock.state === "stale";
  if (!pending.length && staleLock && !reason)
    return {
      canRecover: true,
      staleLock,
      reason: `发现遗留写入锁：${lock.reason}，没有待恢复的写入。确认后将清理写锁并备份。`,
      id: lock.owner.id,
      fingerprint: lock.fingerprint,
      files: [] as { file: string; state: string }[],
      kind: "lock" as const,
    };
  if (!pending.length)
    return {
      canRecover: false,
      reason: reason || "没有待恢复的写入。",
      id: "",
      fingerprint: "",
      files: [] as { file: string; state: string }[],
    };
  if (pending.length !== 1 || ![CHAPTER, ACCEPT].includes(pending[0]))
    return {
      canRecover: false,
      reason: reason || "有其他未完成操作，请先备份并核对原操作，不能在此自动恢复。",
      id: "",
      fingerprint: "",
      files: [] as { file: string; state: string }[],
    };
  const file = path.join(dir, pending[0]);
  const fingerprint = await snapshotFile(file);
  const record =
    pending[0] === CHAPTER ? await inspectPendingChapterSave(dir) : await inspectPendingAccept(dir);
  if (!fingerprint || fingerprint !== (await snapshotFile(file)))
    throw new Error("恢复记录正在变化，请稍后重新检查");
  try {
    ensureRecoveryOwnerInactive(record.owner);
  } catch (error) {
    reason ||= errorText(error);
  }
  if (record.conflict) reason ||= "作品文件与恢复记录冲突，请保留文件并人工核对。";
  return {
    canRecover: !reason,
    staleLock,
    reason:
      reason ||
      (staleLock
        ? `发现未完成写入和遗留写入锁：${lock.reason}。确认后将清理写锁、备份并核验，再完成原操作。`
        : "发现未完成写入。可在备份并核验后完成原操作。"),
    id: record.id,
    fingerprint,
    files: record.writes,
    kind: pending[0] === CHAPTER ? ("chapter" as const) : ("accept" as const),
  };
}

export async function recoverWork(
  dir: string,
  expected: { id: string; fingerprint: string },
  steps: {
    backup: () => Promise<string | null>;
    lockCleared: (owner: { pid: number; host: string; createdAt: string }) => Promise<void>;
  },
) {
  const check = async () => {
    const state = await inspectRecovery(dir);
    if (!state.canRecover || state.id !== expected.id || state.fingerprint !== expected.fingerprint)
      throw new Error(state.reason || "恢复记录已变化，请重新检查");
    return state;
  };
  const first = await check();
  // The backup script refuses a tree with a write lock, so the stale lock goes first.
  if (first.staleLock) await steps.lockCleared(await clearWriteLock(dir));
  const backupFile = await steps.backup();
  if (!backupFile) throw new Error("已取消备份，未执行恢复");
  if (first.kind === "lock") return { backup: backupFile, state: await inspectRecovery(dir) };
  try {
    const state = await check();
    if (state.kind === "chapter") await resumePendingChapterSave(dir, expected);
    else await resumePendingAccept(dir, expected);
    // Recheck for a journal rather than reading metadata that may belong to another pending operation.
    const after = await inspectRecovery(dir);
    return { backup: backupFile, state: after };
  } catch (error) {
    throw new Error(`已备份到 ${backupFile}；恢复未完成：${errorText(error)}`);
  }
}
