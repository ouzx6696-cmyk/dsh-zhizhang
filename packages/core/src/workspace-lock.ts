import { isMissingFileError } from "./fsx.js";
/** A host owns an open workspace; other processes may read but cannot write. */
import { open, readFile, unlink, realpath } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import path from "node:path";
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
async function ownerAt(root: string): Promise<WorkspaceOwner | null> {
  try {
    return JSON.parse(await readFile(path.join(root, FILE), "utf8"));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}
function live(owner: WorkspaceOwner) {
  if (owner.machine !== hostname()) return true;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return !(error instanceof Error && "code" in error && error.code === "ESRCH");
  }
}
export async function workspaceAccess(root: string) {
  let current = path.resolve(root);
  for (;;) {
    const owner = await ownerAt(current);
    if (
      owner &&
      (owner.pid !== process.pid || owner.machine !== hostname()) &&
      live(owner)
    )
      return { readOnly: true, owner };
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { readOnly: false, owner: null };
}
export async function claimWorkspace(root: string) {
  const key = await realpath(root);
  const access = await workspaceAccess(key);
  if (access.readOnly && access.owner && live(access.owner)) return access;
  const previous = await ownerAt(key);
  if (
    previous &&
    previous.pid === process.pid &&
    previous.machine === hostname()
  )
    return { readOnly: false, owner: previous };
  if (previous && !live(previous)) {
    const current = await ownerAt(key);
    if (current?.id === previous.id) await unlink(path.join(key, FILE));
  }
  const owner: WorkspaceOwner = {
    id: randomUUID(),
    pid: process.pid,
    machine: hostname(),
    host,
    at: new Date().toISOString(),
  };
  try {
    const handle = await open(path.join(key, FILE), "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(owner));
    } finally {
      await handle.close();
    }
    held.set(key, owner);
    return { readOnly: false, owner };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST")
      return { readOnly: true, owner: await ownerAt(key) };
    throw error;
  }
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
    if ((await ownerAt(key))?.id === owner.id)
      await unlink(path.join(key, FILE));
    held.delete(key);
  }
}
export async function releaseWorkspaces() {
  for (const root of held.keys()) await releaseWorkspace(root);
}
process.once("exit", () => {
  for (const [root, owner] of held) {
    try {
      if (
        JSON.parse(readFileSync(path.join(root, FILE), "utf8")).id === owner.id
      )
        unlinkSync(path.join(root, FILE));
    } catch (error) {
      if (!isMissingFileError(error)) console.error("退出时释放作品锁失败：", error);
    }
  }
});
