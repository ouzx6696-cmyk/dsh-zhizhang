/** Bounded read cache for panel polling. Metadata changes invalidate cached text.
 * Acceptance and recovery use uncached bytes; cache hits are not integrity proofs.
 */
import { readFile, stat } from "node:fs/promises";

interface CacheEntry {
    mtimeMs: number;
    ctimeMs: number;
    ino: number;
    size: number;
    text: string;
}

const MAX_ENTRIES = 800;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;
let textBytes = 0;
const textCache = new Map<string, CacheEntry>();

function remember(file: string, entry: CacheEntry) {
    // 先 delete 再 set 把键移到最新；淘汰时从最旧开始（近似 LRU）。
    const prior = textCache.get(file);
    if (prior) textBytes -= prior.text.length * 2;
    textCache.delete(file);
    if (entry.text.length * 2 > MAX_TEXT_BYTES) return;
    textCache.set(file, entry);
    textBytes += entry.text.length * 2;
    while (textCache.size > MAX_ENTRIES || textBytes > MAX_TEXT_BYTES) {
        const oldest = textCache.keys().next().value;
        if (oldest === undefined) break;
        textBytes -= textCache.get(oldest)!.text.length * 2;
        textCache.delete(oldest);
    }
}

/** Cached polling read; callers needing integrity must read and hash the file directly. */
export async function readTextCached(file: string): Promise<string> {
    const st = await stat(file);
    const hit = textCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.ctimeMs === st.ctimeMs && hit.ino === st.ino && hit.size === st.size)
        return hit.text;
    const text = await readFile(file, "utf8");
    const after = await stat(file);
    if (st.mtimeMs === after.mtimeMs && st.ctimeMs === after.ctimeMs && st.ino === after.ino && st.size === after.size)
        remember(file, { mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, ino: after.ino, size: after.size, text });
    return text;
}

/** readTextCached + JSON.parse；解析失败照常抛错（坏文件不缓存）。 */
export async function readJsonCached<T = any>(file: string): Promise<T> {
    return JSON.parse(await readTextCached(file)) as T;
}

/** JSONL: an absent file is empty; malformed or inaccessible files remain visible errors. */
export async function readJsonlCached(file: string): Promise<any[]> {
    let raw: string;
    try {
        raw = await readTextCached(file);
    }
    catch (err: any) {
        if (err?.code === "ENOENT") return [];
        throw err;
    }
    const out = [];
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try { out.push(JSON.parse(line)); }
        catch { throw new Error(`分析文件 JSONL 格式损坏：${file}，第 ${i + 1} 行`); }
    }
    return out;
}
