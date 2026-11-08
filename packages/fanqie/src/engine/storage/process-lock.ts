/** Cooperative filesystem lock for writers in different processes sharing a resource. */
import { assertWorkspaceWritable } from "../../../../core/src/workspace-lock.js";
import { isFsError, isMissingFileError, sha256 } from "../../../../core/src/fsx.js";
import { errorText } from "../../../../core/src/errors.js";
import { isRecord } from "../../../../core/src/parse.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rmdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { NovelError } from "../errors.js";
import { assertSafeAncestors, withLock } from "./primitives.js";

const held = new AsyncLocalStorage<Set<string>>();
const LOCK_DIR = ".writer-write-lock";
const OWNER_FILE = "owner.json";
const WAIT_MS = 10000;

/** owner.json 的落盘形状；由本模块独占写出。 */
interface LockOwner {
  id: string;
  pid: number;
  host: string;
  createdAt: string;
}

/**
 * The lock is never broken on a timeout or PID check while writers run. A lock left by a
 * crashed process is cleared only through clearWriteLock, after the author confirms.
 * Only cooperating writers participate; external edits remain unprotected.
 */
export async function withResourceLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  await assertWorkspaceWritable(root);
  await assertSafeAncestors(path.join(root, ".lock-check"));
  const key = await realpath(root);
  const previous = held.getStore();
  if (previous?.has(key)) return fn();
  return withLock(`resource:${key}`, async () => {
    const dir = path.join(key, LOCK_DIR);
    const ownerFile = path.join(dir, OWNER_FILE);
    const owner = {
      id: randomUUID(),
      pid: process.pid,
      host: hostname(),
      createdAt: new Date().toISOString(),
    };
    const deadline = Date.now() + WAIT_MS;
    for (;;) {
      try {
        await mkdir(dir);
        break;
      } catch (err) {
        if (!isFsError(err, "EEXIST")) throw err;
        if (Date.now() >= deadline)
          throw new NovelError(
            "resource_locked",
            `资源正被其他进程使用，或遗留写入锁：${dir}。请先确认没有进程正在写入，再人工核对锁和未完成操作；不会仅凭超时自动清锁。`,
          );
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    try {
      const handle = await open(ownerFile, "wx", 0o600);
      try {
        await handle.writeFile(JSON.stringify(owner) + "\n");
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (err) {
      // A partly created lock is kept for inspection rather than removed blindly.
      throw new NovelError(
        "resource_lock_invalid",
        `无法建立锁所有权记录：${dir}；请确认没有写入进程后人工核对。${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const next = new Set(previous ?? []);
    next.add(key);
    let outcome: { ok: true; value: T } | { ok: false; error: unknown };
    try {
      outcome = { ok: true, value: await held.run(next, fn) };
    } catch (error) {
      outcome = { ok: false, error };
    }
    try {
      await releaseOwner(dir, owner.id);
    } catch (releaseError) {
      // A release failure must never hide why the write itself failed.
      if (!outcome.ok)
        throw new AggregateError(
          [outcome.error, releaseError],
          `${errorText(outcome.error)}；另外写入锁未能释放：${errorText(releaseError)}`,
        );
      throw releaseError;
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.value;
  });
}

async function releaseOwner(dir: string, id: string) {
  const ownerFile = path.join(dir, OWNER_FILE);
  let current: LockOwner;
  try {
    current = JSON.parse(await readFile(ownerFile, "utf8"));
  } catch (error) {
    throw new NovelError(
      "resource_lock_invalid",
      `锁记录不可读，已保留 ${dir}，请人工核对。（${errorText(error)}）`,
    );
  }
  if (current.id !== id)
    throw new NovelError("resource_lock_invalid", `锁所有权变化，已保留 ${dir}，请人工核对。`);
  await unlink(ownerFile);
  try {
    await rmdir(dir);
  } catch (error) {
    throw new NovelError(
      "resource_lock_invalid",
      `锁目录未能移除：${dir}，请人工核对。（${errorText(error)}）`,
    );
  }
}

/** Decides whether a recorded writer can no longer touch the files it was writing. */
export function ensureRecoveryOwnerInactive(owner: Pick<LockOwner, "pid" | "host">) {
  if (owner.host !== hostname())
    throw new NovelError(
      "recovery_owner_unknown",
      "恢复记录来自另一台主机，无法确认原进程已停止；请先由管理员核对，暂不自动恢复。",
    );
  if (owner.pid === process.pid) return; // The caller holds the operation's resource locks.
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
    throw new NovelError("recovery_owner_unknown", "无法确认原进程是否停止，暂不自动恢复。");
  }
  throw new NovelError(
    "recovery_owner_active",
    "原进程仍存在（或进程号已复用），暂不自动恢复；请先核对原进程状态。",
  );
}

type WriteLockState =
  | { state: "absent" }
  | { state: "unknown"; dir: string; reason: string }
  | {
      state: "active" | "stale";
      dir: string;
      owner: LockOwner;
      fingerprint: string;
      reason: string;
    };

/** owner.json is written by other processes, so it is parsed like any untrusted file. */
function parseLockOwner(raw: string): LockOwner | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid <= 0 ||
    typeof value.host !== "string" ||
    typeof value.createdAt !== "string"
  )
    return null;
  return { id: value.id, pid: value.pid, host: value.host, createdAt: value.createdAt };
}

/**
 * A lock is stale only when its owner is provably gone. Our own pid always counts as live:
 * ensureRecoveryOwnerInactive lets it through for journal replay, which is wrong for a lock.
 */
export async function inspectWriteLock(root: string): Promise<WriteLockState> {
  const dir = path.join(await realpath(root), LOCK_DIR);
  try {
    await lstat(dir);
  } catch (error) {
    if (isMissingFileError(error)) return { state: "absent" };
    throw error;
  }
  let raw: string;
  try {
    raw = await readFile(path.join(dir, OWNER_FILE), "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { state: "unknown", dir, reason: "写入锁缺少所有者记录，无法判断原进程状态" };
  }
  const owner = parseLockOwner(raw);
  if (!owner)
    return { state: "unknown", dir, reason: "写入锁的所有者记录损坏，无法判断原进程状态" };
  const fingerprint = sha256(raw);
  if (owner.pid === process.pid)
    return {
      state: "active",
      dir,
      owner,
      fingerprint,
      reason: "写入锁由当前应用持有，写入仍在进行",
    };
  try {
    ensureRecoveryOwnerInactive(owner);
  } catch (error) {
    if (!(error instanceof NovelError)) throw error;
    if (error.code === "recovery_owner_active")
      return { state: "active", dir, owner, fingerprint, reason: error.message };
    return { state: "unknown", dir, reason: error.message };
  }
  return {
    state: "stale",
    dir,
    owner,
    fingerprint,
    reason: `写入锁的原进程（${owner.pid}）已停止`,
  };
}

/** Removes a lock only when it is provably stale; any other state is reported, never cleared. */
export async function clearWriteLock(root: string) {
  const lock = await inspectWriteLock(root);
  if (lock.state !== "stale")
    throw new NovelError(
      "resource_lock_not_stale",
      lock.state === "absent" ? "没有遗留写入锁。" : `写入锁不能清理：${lock.reason}。`,
    );
  const ownerFile = path.join(lock.dir, OWNER_FILE);
  // Another cleaner may have removed the lock and a new writer taken it since inspection.
  if (sha256(await readFile(ownerFile, "utf8")) !== lock.fingerprint)
    throw new NovelError("resource_lock_changed", "写入锁在检查后发生变化，未清理；请重新检查。");
  await unlink(ownerFile);
  await rmdir(lock.dir);
  return lock.owner;
}
