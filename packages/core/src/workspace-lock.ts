/** A host owns an open workspace; other processes may read but cannot write. */
import { link, open, readFile, unlink, realpath, mkdir, rmdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { isFsError, isMissingFileError, serialize, withFileGate } from "./fsx.js";
import { errorText } from "./errors.js";
import { isRecord } from "./parse.js";
import { WriterError } from "./tool.js";
const FILE = ".writer-workspace-lock.json";
/**
 * 登记互斥目录与其中 pid 登记文件：认领者持有目录并在其中发布 owner.json 后才操作作品锁。
 * 崩溃会遗留登记，但凭登记里的 pid 可判定持有者是否存活，已死即安全清理；
 * 没有登记文件的空目录是登记机制引入前的遗留，同样可清理。
 */
const GUARD = ".writer-workspace-claim";
const GUARD_REGISTRATION = "owner.json";
/** 并发登记者正在目录里发布登记时，Windows 的 rmdir 可能报这些错误而不是 ENOTEMPTY。 */
const GUARD_BUSY = ["EPERM", "EACCES", "EBUSY"];
export type WorkspaceOwner = {
  id: string;
  pid: number;
  machine: string;
  host: string;
  at: string;
};
export type WorkspaceAccess =
  { readOnly: true; owner: WorkspaceOwner } | { readOnly: false; owner: WorkspaceOwner | null };
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
    !Number.isInteger(value.pid) ||
    value.pid <= 0 ||
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
function ownRecord(): WorkspaceOwner {
  return {
    id: randomUUID(),
    pid: process.pid,
    machine: hostname(),
    host,
    at: new Date().toISOString(),
  };
}
export async function workspaceAccess(root: string): Promise<WorkspaceAccess> {
  let current = path.resolve(root);
  for (;;) {
    const owner = await ownerAt(current);
    if (owner && !isSelf(owner) && live(owner)) return { readOnly: true as const, owner };
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { readOnly: false as const, owner: null };
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

type GuardState =
  | { kind: "absent" }
  | { kind: "held"; owner: WorkspaceOwner }
  | { kind: "idle"; owner: WorkspaceOwner | null };

async function readGuardState(guard: string): Promise<GuardState> {
  try {
    await stat(guard);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { kind: "absent" };
  }
  const file = path.join(guard, GUARD_REGISTRATION);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { kind: "idle", owner: null };
  }
  const owner = parseOwner(raw, file);
  return live(owner) ? { kind: "held", owner } : { kind: "idle", owner };
}

/**
 * 移除无主登记。ENOTEMPTY 说明并发登记者刚写入登记（或目录含外来文件），按当前内容重新判定；
 * Windows 上目录句柄尚未关闭时 rmdir 报 EPERM/EACCES/EBUSY，同样表示目录已转给并发登记者。
 */
async function sweepIdleGuard(guard: string, owner: WorkspaceOwner | null): Promise<GuardState> {
  if (owner) {
    try {
      await unlink(path.join(guard, GUARD_REGISTRATION));
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  let busy: unknown = null;
  try {
    await rmdir(guard);
    return { kind: "absent" };
  } catch (error) {
    if (isMissingFileError(error)) return { kind: "absent" };
    if (GUARD_BUSY.some((code) => isFsError(error, code))) busy = error;
    else if (!isFsError(error, "ENOTEMPTY")) throw error;
  }
  const state = await readGuardState(guard);
  // Windows 上并发进程正在 stat/读取该目录或它处于删除挂起时 rmdir 报占用，而目录里并没有外来文件：
  // 原样抛出占用错误，由 withClaimGuard 按争用等待重试，超时才报错。
  if (busy && state.kind === "idle" && !state.owner) throw busy;
  if (state.kind === "idle" && !state.owner)
    throw new WriterError(
      "CONFLICT",
      `作品占用登记目录含有未知文件，不自动清理：${guard}。请人工核对后删除该目录。`,
    );
  return state;
}

async function writeGuardRegistration(key: string) {
  const owner = ownRecord();
  // 与作品锁同款发布方式：临时文件写在作品根而非登记目录里，清理者不会把在途临时文件误当外来文件。
  const tmp = path.join(key, `${GUARD}.${owner.id}.tmp`);
  const handle = await open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(owner));
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(tmp, path.join(key, GUARD, GUARD_REGISTRATION));
  } catch (error) {
    if (!NO_HARD_LINKS.some((code) => isFsError(error, code))) throw error;
    // 无硬链接卷退回 wx 直写；崩溃留下半截登记的处理与作品锁在同类卷上的取舍一致。
    const direct = await open(path.join(key, GUARD, GUARD_REGISTRATION), "wx", 0o600);
    try {
      await direct.writeFile(JSON.stringify(owner));
      await direct.sync();
    } finally {
      await direct.close();
    }
  } finally {
    await unlink(tmp);
  }
}

async function releaseGuard(guard: string) {
  try {
    await unlink(path.join(guard, GUARD_REGISTRATION));
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  try {
    await rmdir(guard);
  } catch (error) {
    // ENOENT：并发清理者已移走。ENOTEMPTY/占用：目录已转给刚写入登记的并发登记者，由其收尾。
    if (
      !isMissingFileError(error) &&
      !isFsError(error, "ENOTEMPTY") &&
      !GUARD_BUSY.some((code) => isFsError(error, code))
    )
      throw error;
  }
}

type GuardAttempt = "claimed" | "retry" | "wait";

/** 抢一次登记目录：claimed 已登记；retry 目录刚被清走，立即再抢；wait 他人持有或正在登记。 */
async function attemptGuard(key: string, guard: string, deadline: number): Promise<GuardAttempt> {
  try {
    await mkdir(guard);
  } catch (error) {
    if (!isFsError(error, "EEXIST")) throw error;
    const state = await readGuardState(guard);
    if (state.kind === "held") {
      if (Date.now() >= deadline)
        throw new WriterError(
          "CONFLICT",
          `作品占用登记由 ${state.owner.host}（进程 ${state.owner.pid}）持有：${guard}。请先关闭占用该作品的其他应用。`,
        );
      return "wait";
    }
    const after = await sweepIdleGuard(guard, state.kind === "idle" ? state.owner : null);
    // 登记在清理间隙被并发写入：按持有处理，回到等待节奏。
    return after.kind === "absent" ? "retry" : "wait";
  }
  // 已持有登记目录；目录被并发清理（ENOENT）或被并发登记者抢先登记（EEXIST）时重新抢。
  try {
    await writeGuardRegistration(key);
    return "claimed";
  } catch (error) {
    if (!isMissingFileError(error) && !isFsError(error, "EEXIST")) throw error;
    return "retry";
  }
}

/** Serialize reclamation and publication together: unlink cannot compare ownership atomically. */
function withClaimGuard<T>(key: string, fn: () => Promise<T>): Promise<T> {
  return serialize(`workspace-claim:${key}`, () =>
    withFileGate(
      path.join(key, ".writer-workspace-claim-gate"),
      async () => {
        const guard = path.join(key, GUARD);
        const deadline = Date.now() + 2000;
        for (;;) {
          let next: GuardAttempt;
          try {
            next = await attemptGuard(key, guard, deadline);
          } catch (error) {
            // Windows 上刚被并发清理的登记目录在其他进程关闭句柄前处于删除挂起：mkdir、stat、
            // 读写登记都报 EPERM/EACCES/EBUSY。这是争用而非权限问题，等它消失再抢；超时原样抛出。
            if (!GUARD_BUSY.some((code) => isFsError(error, code)) || Date.now() >= deadline)
              throw error;
            next = "wait";
          }
          if (next === "claimed") break;
          if (next === "wait") await new Promise((resolve) => setTimeout(resolve, 25));
        }
        try {
          return await fn();
        } finally {
          await releaseGuard(guard);
        }
      },
      2000,
    ),
  );
}

export async function claimWorkspace(root: string) {
  const key = await realpath(root);
  return withClaimGuard(key, () => claimWorkspaceUnlocked(key));
}

/**
 * 作者确认后接管：另一台设备的锁（主机名变化、同步盘带来的锁）或进程号被复用的锁无法自动判定，
 * 只能由作者确认原处已关闭。只替换作者看到的那把锁，确认期间换了人就拒绝。
 */
export async function takeOverWorkspace(root: string, ownerId: string): Promise<WorkspaceAccess> {
  const key = await realpath(root);
  return withClaimGuard(key, async () => {
    if ((await ownerAt(key))?.id !== ownerId)
      throw new WriterError("CONFLICT", "作品锁已变化，请重新查看占用情况后再决定是否接管。");
    await unlink(path.join(key, FILE));
    const owner = ownRecord();
    if (!(await publishOwner(key, owner)))
      throw new WriterError("CONFLICT", `接管期间作品锁被其他进程抢占：${key}`);
    held.set(key, owner);
    return { readOnly: false, owner };
  });
}

export type WorkspaceClaimCleanup =
  | { kind: "cleaned"; owner: { pid: number; host: string; at: string } | null }
  | { kind: "occupied"; owner: { pid: number; host: string } }
  | { kind: "absent" };

/**
 * 启动自愈入口：作品占用登记的持有进程已死（或旧版遗留的空登记目录）时安全移除；
 * 登记者仍存活则原样保留，由后续 claimWorkspace 照常报占用。
 */
export async function cleanStaleWorkspaceClaim(root: string): Promise<WorkspaceClaimCleanup> {
  let key: string;
  try {
    key = await realpath(root);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { kind: "absent" }; // 作品根不存在则没有登记可清理
  }
  const guard = path.join(key, GUARD);
  return serialize(`workspace-claim:${key}`, () =>
    withFileGate(
      path.join(key, ".writer-workspace-claim-gate"),
      async () => {
        for (;;) {
          const state = await readGuardState(guard);
          if (state.kind === "absent") return { kind: "absent" };
          if (state.kind === "held")
            return { kind: "occupied", owner: { pid: state.owner.pid, host: state.owner.host } };
          const after = await sweepIdleGuard(guard, state.owner);
          if (after.kind === "absent")
            return {
              kind: "cleaned",
              owner: state.owner
                ? { pid: state.owner.pid, host: state.owner.host, at: state.owner.at }
                : null,
            };
          if (after.kind === "idle") continue; // 登记内容在清理间隙发生变化，重新判定
          return { kind: "occupied", owner: { pid: after.owner.pid, host: after.owner.host } };
        }
      },
      2000,
    ),
  );
}
async function claimWorkspaceUnlocked(root: string): Promise<WorkspaceAccess> {
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
    const owner = ownRecord();
    if (await publishOwner(key, owner)) {
      held.set(key, owner);
      return { readOnly: false, owner };
    }
    const winner = await ownerAt(key);
    if (winner && live(winner)) return { readOnly: true, owner: winner };
  }
  throw new WriterError("CONFLICT", `作品锁反复被其他进程抢占：${key}`);
}
/** 只读打开时拒绝写入的统一错误：工具、存储与主进程请求入口共用一份文案与错误码。 */
export function workspaceReadOnlyError(owner: WorkspaceOwner) {
  return new WriterError(
    "CONFLICT",
    `作品由 ${owner.host} 占用（进程 ${owner.pid}），当前只读。请先在另一应用关闭作品。`,
  );
}
export async function assertWorkspaceWritable(root: string) {
  const access = await workspaceAccess(root);
  if (access.readOnly) throw workspaceReadOnlyError(access.owner);
}
export async function releaseWorkspace(root: string) {
  const resolved = path.resolve(root);
  const key = held.has(resolved) ? resolved : await realpath(root),
    owner = held.get(key);
  if (!owner) return;
  try {
    await withClaimGuard(key, async () => {
      if ((await ownerAt(key))?.id === owner.id) await unlink(path.join(key, FILE));
    });
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  held.delete(key);
}
export async function releaseWorkspaces() {
  for (const root of held.keys()) await releaseWorkspace(root);
}
