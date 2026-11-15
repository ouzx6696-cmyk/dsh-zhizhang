import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "../errors/app-error.js";
import { atomicWrite } from "../fs/atomic.js";
const activeLocks = new AsyncLocalStorage();
const LOCK_DIR_NAME = ".zhizhang-lock";
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export async function withWriteLock(resource, clock, fn, waitMs = 10_000) {
    const held = activeLocks.getStore() ?? new Set();
    const key = `${resource.kind}:${path.resolve(resource.path)}`;
    if (held.has(key))
        return fn();
    const lockDir = path.join(path.dirname(path.resolve(resource.path)), `${LOCK_DIR_NAME}-${path.basename(resource.path)}`);
    const ownerFile = path.join(lockDir, "owner.json");
    const deadline = clock.now() + waitMs;
    while (true) {
        try {
            await fs.mkdir(lockDir);
            break;
        }
        catch (err) {
            const code = err.code;
            if (code !== "EEXIST")
                throw err;
            if (clock.now() >= deadline) {
                throw new AppError("storage.locked", "另一处正在写入该资源，请稍后重试", {
                    resource: key,
                    lockDir,
                });
            }
            await clock.sleep(50);
        }
    }
    try {
        await atomicWrite(ownerFile, JSON.stringify({
            owner: `${os.hostname()}:${process.pid}`,
            pid: process.pid,
            host: os.hostname(),
            acquiredAt: clock.iso(),
        }));
        const next = new Set(held);
        next.add(key);
        return await activeLocks.run(next, fn);
    }
    finally {
        await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
    }
}
export async function inspectStaleLocks(root) {
    const results = [];
    const host = os.hostname();
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        if (!entry.isDirectory() || !entry.name.startsWith(LOCK_DIR_NAME))
            continue;
        const lockDir = path.join(root, entry.name);
        const raw = await fs.readFile(path.join(lockDir, "owner.json"), "utf8").catch(() => undefined);
        if (!raw)
            continue;
        try {
            const parsed = JSON.parse(raw);
            if (typeof parsed.pid === "number" &&
                parsed.host === host &&
                !isPidAlive(parsed.pid)) {
                results.push({
                    lockDir,
                    owner: parsed.owner ?? `${host}:${parsed.pid}`,
                    pid: parsed.pid,
                    host: parsed.host,
                    acquiredAt: parsed.acquiredAt ?? "",
                });
            }
        }
        catch {
            // ignore malformed owner
        }
    }
    return results;
}
export async function clearStaleLock(lock, confirm) {
    if (!confirm.confirmedByAuthor) {
        throw new AppError("gate.denied", "清理遗留写锁需要作者确认");
    }
    if (lock.host !== os.hostname() || isPidAlive(lock.pid)) {
        throw new AppError("storage.locked", "仅允许清理本机且原进程已停止的写锁", {
            pid: lock.pid,
            host: lock.host,
        });
    }
    await fs.rm(lock.lockDir, { recursive: true, force: true });
}
