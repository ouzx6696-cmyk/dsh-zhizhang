/** Bounded read cache for panel polling. Metadata changes invalidate cached text.
 * Acceptance and recovery use uncached bytes; cache hits are not integrity proofs.
 */
import { readFile, stat } from "node:fs/promises";
import { isMissingFileError } from "../../../core/src/fsx.js";

interface CacheEntry {
    mtimeMs: number;
    ctimeMs: number;
    ino: number;
    size: number;
    text: string;
    jsonl?: Record<string, unknown>[];
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
        const oldest = textCache.entries().next().value;
        if (oldest === undefined) break;
        textBytes -= oldest[1].text.length * 2;
        textCache.delete(oldest[0]);
    }
}

async function readEntryCached(file: string): Promise<CacheEntry> {
    const st = await stat(file);
    const hit = textCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.ctimeMs === st.ctimeMs && hit.ino === st.ino && hit.size === st.size)
        return hit;
    const text = await readFile(file, "utf8");
    const after = await stat(file);
    const entry: CacheEntry = { mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs, ino: after.ino, size: after.size, text };
    if (st.mtimeMs === after.mtimeMs && st.ctimeMs === after.ctimeMs && st.ino === after.ino && st.size === after.size)
        remember(file, entry);
    return entry;
}

/** Cached polling read; callers needing integrity must read and hash the file directly. */
export async function readTextCached(file: string): Promise<string> {
    return (await readEntryCached(file)).text;
}

/** readTextCached + JSON.parse；解析失败照常抛错（坏文件不缓存）。 */
export async function readJsonCached<T = Record<string, any>>(file: string): Promise<T> {
    return JSON.parse(await readTextCached(file)) as T;
}

/**
 * JSONL: an absent file is empty; malformed or inaccessible files remain visible errors.
 * 缓存层只负责解析与复用行对象，具体行结构由调用方声明。
 * 命中缓存时返回行对象的浅拷贝：调用方只读，嵌套字段与缓存共享引用。
 */
export async function readJsonlCached<T = Record<string, any>>(file: string): Promise<T[]> {
    let entry: CacheEntry;
    try {
        entry = await readEntryCached(file);
    }
    catch (err) {
        if (isMissingFileError(err)) return [];
        throw err;
    }
    if (entry.jsonl) {
        return entry.jsonl.map((item) => ({ ...item })) as T[];
    }
    const out: Record<string, unknown>[] = [];
    const lines = entry.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        try { out.push(JSON.parse(line)); }
        catch { throw new Error(`分析文件 JSONL 格式损坏：${file}，第 ${i + 1} 行`); }
    }
    entry.jsonl = out;
    return out.map((item) => ({ ...item })) as T[];
}
