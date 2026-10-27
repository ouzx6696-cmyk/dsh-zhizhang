/** Cooperative filesystem lock for writers in different processes sharing a resource. */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, realpath, rmdir, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { assertSafeAncestors, withLock } from "./primitives.js";
const held = new AsyncLocalStorage();
const LOCK_DIR = ".zhizhang-write-lock";
const WAIT_MS = 10000;
/**
 * The lock is never broken on a timeout or PID check. If a process dies, an
 * operator must verify that no writer is active before removing the lock.
 * Only cooperating writers participate; external edits remain unprotected.
 */
export async function withResourceLock(root, fn) {
    await assertSafeAncestors(path.join(root, ".lock-check"));
    const key = await realpath(root);
    const previous = held.getStore();
    if (previous?.has(key))
        return fn();
    return withLock(`resource:${key}`, async () => {
        const dir = path.join(key, LOCK_DIR);
        const ownerFile = path.join(dir, "owner.json");
        const owner = { id: randomUUID(), pid: process.pid, host: hostname(), createdAt: new Date().toISOString() };
        const deadline = Date.now() + WAIT_MS;
        for (;;) {
            try {
                await mkdir(dir);
                break;
            }
            catch (err) {
                if (err?.code !== "EEXIST")
                    throw err;
                if (Date.now() >= deadline)
                    throw new ZhizhangError("resource_locked", `资源正被其他进程使用，或遗留写入锁：${dir}。请先确认没有进程正在写入，再人工核对锁和未完成操作；不会仅凭超时自动清锁。`);
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
        }
        try {
            const handle = await open(ownerFile, "wx", 0o600);
            try {
                await handle.writeFile(JSON.stringify(owner) + "\n");
                await handle.sync();
            }
            finally {
                await handle.close();
            }
        }
        catch (err) {
            // A partly created lock is kept for inspection rather than removed blindly.
            throw new ZhizhangError("resource_lock_invalid", `无法建立锁所有权记录：${dir}；请确认没有写入进程后人工核对。${err instanceof Error ? err.message : String(err)}`);
        }
        try {
            const next = new Set(previous ?? []);
            next.add(key);
            return await held.run(next, fn);
        }
        finally {
            let current;
            try {
                current = JSON.parse(await readFile(ownerFile, "utf8"));
            }
            catch {
                throw new ZhizhangError("resource_lock_invalid", `锁记录不可读，已保留 ${dir}，请人工核对。`);
            }
            if (current.id !== owner.id)
                throw new ZhizhangError("resource_lock_invalid", `锁所有权变化，已保留 ${dir}，请人工核对。`);
            await unlink(ownerFile);
            try {
                await rmdir(dir);
            }
            catch {
                throw new ZhizhangError("resource_lock_invalid", `锁目录未能移除：${dir}，请人工核对。`);
            }
        }
    });
}
