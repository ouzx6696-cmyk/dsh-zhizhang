import os from "node:os";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "../clock.js";
import { AppError } from "../errors/app-error.js";
import { atomicWrite } from "../fs/atomic.js";
import { readJson } from "../fs/read.js";
import { obj, lit, str, int } from "../schema/index.js";
import { withWriteLock, type ResourceKey } from "./write-lock.js";
import { WORKSPACE_META_DIR } from "../paths.js";

export interface Lease {
  readonly root: string;
  readonly owner: string;
  release(): Promise<void>;
}

const LeaseSchema = obj({
  format: lit("zhizhang/1.3"),
  owner: str(),
  pid: int(),
  host: str(),
  acquiredAt: str(),
});

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !(err instanceof Error && "code" in err && err.code === "ESRCH");
  }
}

export async function acquireLease(
  root: string,
  clock: Clock,
  expectedOwner?: string,
): Promise<Lease> {
  const dir = path.join(root, WORKSPACE_META_DIR);
  const file = path.join(dir, "lease.json");
  await fs.mkdir(dir, { recursive: true });
  const host = os.hostname();
  const owner = `${host}:${process.pid}:${randomUUID()}`;
  const resource: ResourceKey = { kind: "work", path: root };
  await withWriteLock(resource, clock, async () => {
    const prev = await readJson(file, LeaseSchema);
    if (expectedOwner !== undefined && prev?.owner !== expectedOwner) {
      throw new AppError("storage.conflict", "占用者已变化，请刷新后再接管");
    }
    if (prev && expectedOwner === undefined && (prev.host !== host || isPidAlive(prev.pid))) {
      throw new AppError("storage.locked", "写作文件夹已被另一个织章实例打开", {
        readonly: true,
        owner: prev.owner,
      });
    }
    await atomicWrite(
      file,
      JSON.stringify(
        {
          format: "zhizhang/1.3",
          owner,
          pid: process.pid,
          host,
          acquiredAt: clock.iso(),
        },
        null,
        2,
      ),
    );
  });
  return {
    root,
    owner,
    async release() {
      await withWriteLock(resource, clock, async () => {
        const current = await readJson(file, LeaseSchema);
        if (current?.owner === owner) await fs.rm(file);
      });
    },
  };
}
