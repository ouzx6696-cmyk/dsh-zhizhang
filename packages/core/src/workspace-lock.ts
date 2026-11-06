/** A host owns an open workspace; other processes may read but cannot write. */
import { link, open, readFile, unlink, realpath, mkdir, rmdir } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isFsError, isMissingFileError, serialize } from "./fsx.js";
import { errorText } from "./errors.js";
import { isRecord } from "./parse.js";
import { WriterError } from "./tool.js";
const FILE = ".writer-workspace-lock.json";
export type WorkspaceOwner = {
  id: string;
  pid: number;
  machine: string;
  host: string;
  at: string;
};
let host = "Writer Desktop";
const held = new Map<string, WorkspaceOwner>();
export function setWorkspaceHost(value: string) {
  host = value;
}

/** The lock file is written by other processes, so it is parsed like any other untrusted file. */
function parseOwner(raw: string, file: string): WorkspaceOwner {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new WriterError("CONFLICT", `作品锁文件损坏：${file}（${errorText(error)}）`);
  }
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.pid !== "number" ||
    typeof value.machine !== "string" ||
    typeof value.host !== "string" ||
    typeof value.at !== "string"
  )
    throw new WriterError("CONFLICT", `作品锁文件内容不完整：${file}`);
  return { id: value.id, pid: value.pid, machine: value.machine, host: value.host, at: value.at };
}

async function ownerAt(root: string): Promise<WorkspaceOwner | null> {
  const file = path.join(root, FILE);
  try {
    return parseOwner(await readFile(file, "utf8"), file);
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}
const isSelf = (owner: WorkspaceOwner) => owner.pid === process.pid && owner.machine === hostname();
function live(owner: WorkspaceOwner) {
  if (owner.machine !== hostname()) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return !isFsError(error, "ESRCH");
  }
}
export async function workspaceAccess(root: string) {
  let current = path.resolve(root);
  for (;;) {
    const owner = await ownerAt(current);
    if (owner && !isSelf(owner) && live(owner)) return { readOnly: true, owner };
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { readOnly: false, owner: null };
}

/**
 * Publish the lock with its content already in place: a reader must never see an empty lock
 * file, and a crash must never leave one behind that blocks the workspace forever.
 * link() fails with EEXIST exactly like open('wx'), so creation stays atomic across processes.
 */
async function publishOwner(key: string, owner: WorkspaceOwner): Promise<boolean> {
  const tmp = path.join(key, `${FILE}.${owner.id}.tmp`);
  const handle = await open(tmp, "wx", 0o600);
  try {
    try {
      await handle.writeFile(JSON.stringify(owner));
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(tmp, path.join(key, FILE));
    return true;
  } catch (error) {
    if (isFsError(error, "EEXIST")) return false;
    if (NO_HARD_LINKS.some((code) => isFsError(error, code))) return createOwnerFile(key, owner);
    throw error;
  } finally {
    await unlink(tmp);
  }
}
/** FAT/exFAT volumes and some network shares refuse hard links. */
const NO_HARD_LINKS = ["EPERM", "ENOTSUP", "ENOSYS", "EXDEV"];
async function createOwnerFile(key: string, owner: WorkspaceOwner): Promise<boolean> {
  let handle;
  try {
    handle = await open(path.join(key, FILE), "wx", 0o600);
  } catch (error) {
    if (isFsError(error, "EEXIST")) return false;
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify(owner));
    // 没有硬链接可用的卷上这就是唯一一份锁；不落盘会让崩溃后的空文件把作品永久锁死。
    await handle.sync();
  } finally {
    await handle.close();
  }
  return true;
}

async function removeStaleOwner(key: string, stale: WorkspaceOwner) {
  // 另一个进程可能在 workspaceAccess 与本次读取之间发布活锁：存活即放弃，绝不删活锁。
  if (live(stale)) return;
  // 两个进程可能同时清理同一把陈旧锁；后到者容忍 ENOENT 后照常去抢。
  if ((await ownerAt(key))?.id !== stale.id) return;
  try {
    await unlink(path.join(key, FILE));
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}

/** Serialize reclamation and publication together: unlink cannot compare ownership atomically. */
export async function claimWorkspace(root: string) {
  const key = await realpath(root);
  return serialize(`workspace-claim:${key}`, async () => {
    const guard = path.join(key, ".writer-workspace-claim");
    const deadline = Date.now() + 2000;
    for (;;) {
      try {
        await mkdir(guard);
        break;
      } catch (error) {
        if (!isFsError(error, "EEXIST")) throw error;
        if (Date.now() >= deadline)
          throw new WriterError(
            "CONFLICT",
            `作品占用登记正在进行或留有登记锁：${guard}。请确认没有登记进程后再核对，不会自动清理。`,
          );
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await claimWorkspaceUnlocked(key);
    } finally {
      await rmdir(guard);
    }
  });
}
async function claimWorkspaceUnlocked(root: string) {
  const key = await realpath(root);
  // A competing claim can vanish between EEXIST and our read; re-run the decision a few times.
  for (let attempt = 0; attempt < 3; attempt++) {
    const access = await workspaceAccess(key);
    if (access.readOnly) return access;
    const previous = await ownerAt(key);
    if (previous && isSelf(previous)) {
      held.set(key, previous);
      return { readOnly: false, owner: previous };
    }
    if (previous) await removeStaleOwner(key, previous);
    const owner: WorkspaceOwner = {
      id: randomUUID(),
      pid: process.pid,
      machine: hostname(),
      host,
      at: new Date().toISOString(),
    };
    if (await publishOwner(key, owner)) {
      held.set(key, owner);
      return { readOnly: false, owner };
    }
    const winner = await ownerAt(key);
    if (winner && live(winner)) return { readOnly: true, owner: winner };
  }
  throw new WriterError("CONFLICT", `作品锁反复被其他进程抢占：${key}`);
}
export async function assertWorkspaceWritable(root: string) {
  const access = await workspaceAccess(root);
  if (access.readOnly)
    throw new WriterError(
      "CONFLICT",
      `作品由 ${access.owner?.host || "其他应用"} 占用（进程 ${access.owner?.pid}），当前只读。请先在另一应用关闭作品。`,
    );
}
export async function releaseWorkspace(root: string) {
  const resolved = path.resolve(root);
  const key = held.has(resolved) ? resolved : await realpath(root),
    owner = held.get(key);
  if (owner) {
    if ((await ownerAt(key))?.id === owner.id) await unlink(path.join(key, FILE));
    held.delete(key);
  }
}
export async function releaseWorkspaces() {
  for (const root of held.keys()) await releaseWorkspace(root);
}
process.once("exit", () => {
  for (const [root, owner] of held) {
    try {
      if (JSON.parse(readFileSync(path.join(root, FILE), "utf8")).id === owner.id)
        unlinkSync(path.join(root, FILE));
    } catch (error) {
      if (!isMissingFileError(error)) console.error("退出时释放作品锁失败：", error);
    }
  }
});
