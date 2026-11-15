import os from "node:os";
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors/app-error.js";
import { atomicWrite } from "../fs/atomic.js";
import { WORKSPACE_META_DIR } from "../paths.js";
function isPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export async function acquireLease(root, clock) {
    const dir = path.join(root, WORKSPACE_META_DIR);
    const file = path.join(dir, "lease.json");
    await fs.mkdir(dir, { recursive: true });
    const host = os.hostname();
    const owner = `${host}:${process.pid}`;
    try {
        const raw = await fs.readFile(file, "utf8");
        const prev = JSON.parse(raw);
        if (prev.pid && prev.pid !== process.pid && prev.host === host && isPidAlive(prev.pid)) {
            throw new AppError("storage.locked", "写作文件夹已被另一个织章实例打开", {
                readonly: true,
                owner: prev.owner,
            });
        }
    }
    catch (err) {
        if (err instanceof AppError)
            throw err;
    }
    const record = {
        format: "zhizhang/1.3",
        owner,
        pid: process.pid,
        host,
        acquiredAt: clock.iso(),
    };
    await atomicWrite(file, JSON.stringify(record, null, 2));
    return {
        root,
        owner,
        async release() {
            await fs.rm(file, { force: true }).catch(() => undefined);
        },
    };
}
