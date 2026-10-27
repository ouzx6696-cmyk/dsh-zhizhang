/** Shared process-local synchronization and filesystem primitives. */
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
const locks = new Map<string, Promise<unknown>>();
let tmpSeq = 0;
export async function withLock(key: string, fn: (...args: any[]) => any) {
    const previous = locks.get(key) ?? Promise.resolve();
    let release: () => void = () => { };
    const gate = new Promise((resolve: any) => {
        release = resolve;
    });
    const current = previous.then(() => gate);
    locks.set(key, current);
    await previous;
    try {
        return await fn();
    }
    finally {
        release();
        if (locks.get(key) === current)
            locks.delete(key);
    }
}
export function countWords(text: string) {
    if (typeof text !== "string" || text.length === 0)
        return 0;
    const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
    const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
    return cjk + latin;
}
/** One safe path segment for chapter / candidate ids (no separators, no traversal). */
const SAFE_RESOURCE_ID = /^[^/\\\u0000-\u001f]{1,64}$/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export function assertResourceId(id: string, label: string = "id") {
    const t = String(id ?? "").trim();
    if (!t ||
        !SAFE_RESOURCE_ID.test(t) ||
        t === "." ||
        t === ".." ||
        WINDOWS_RESERVED_NAME.test(t) ||
        /[. ]$/.test(t)) {
        throw new ZhizhangError("bad_id", `${label} 非法（禁止目录穿越 / 保留名）：${t.slice(0, 80)}`);
    }
    return t;
}
export async function atomicWrite(file: string, content: string) {
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.${tmpSeq++}.tmp`;
    const handle = await open(tmp, "wx");
    try {
        await handle.writeFile(content, "utf8");
        await handle.sync();
    }
    catch (err) {
        await handle.close().catch(() => { });
        await rm(tmp, { force: true }).catch(() => { });
        throw err;
    }
    finally {
        await handle.close().catch(() => { });
    }
    try {
        await rename(tmp, file);
    }
    catch (err) {
        // rename 目标被占用等失败时清掉 tmp，避免临时文件在磁盘上累积。
        await rm(tmp, { force: true }).catch(() => { });
        throw err;
    }
}
export function nowIso() {
    return new Date().toISOString();
}
/** Only "file is absent" is a valid reason to create a fresh chapter record. */
export function isMissingFileError(err: any) {
    return err?.code === "ENOENT";
}
