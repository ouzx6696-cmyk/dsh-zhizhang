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
  json?: unknown;
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

function sameFile(
  a: Pick<CacheEntry, "mtimeMs" | "ctimeMs" | "ino" | "size">,
  b: Pick<CacheEntry, "mtimeMs" | "ctimeMs" | "ino" | "size">,
) {
  return a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.size === b.size;
}
async function readEntryCached(file: string): Promise<CacheEntry> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await stat(file);
    if (!before.isFile()) throw new Error(`缓存读取目标不是普通文件：${file}`);
    const hit = textCache.get(file);
    if (hit && sameFile(hit, before)) {
      textCache.delete(file);
      textCache.set(file, hit);
      return hit;
    }
    const text = await readFile(file, "utf8"),
      after = await stat(file);
    if (!sameFile(before, after)) continue;
    const entry: CacheEntry = {
      mtimeMs: after.mtimeMs,
      ctimeMs: after.ctimeMs,
      ino: after.ino,
      size: after.size,
      text,
    };
    remember(file, entry);
    return entry;
  }
  throw new Error(`文件在读取期间持续变化，请稍后刷新：${file}`);
}

/** Cached polling read; callers needing integrity must read and hash the file directly. */
export async function readTextCached(file: string): Promise<string> {
  return (await readEntryCached(file)).text;
}

/** Copy parsed data on return: callers cannot mutate later readers' cached value. */
export async function readJsonCached<T = Record<string, unknown>>(file: string): Promise<T> {
  return (await readJsonCachedWithStat<T>(file)).value;
}
/** Polling candidates need the same metadata identity, without a duplicate stat call. */
export async function readJsonCachedWithStat<T>(file: string) {
  const entry = await readEntryCached(file);
  if (!("json" in entry)) entry.json = JSON.parse(entry.text);
  return {
    value: structuredClone(entry.json) as T,
    identity: [entry.mtimeMs, entry.ctimeMs, entry.ino, entry.size],
  };
}

/**
 * JSONL: an absent file is empty; malformed or inaccessible files remain visible errors.
 * 缓存层只负责解析与复用行对象，具体行结构由调用方声明。
 * 返回独立副本，嵌套字段也不允许污染缓存。
 */
export async function readJsonlCached<T = Record<string, unknown>>(file: string): Promise<T[]> {
  let entry: CacheEntry;
  try {
    entry = await readEntryCached(file);
  } catch (err) {
    if (isMissingFileError(err)) return [];
    throw err;
  }
  if (entry.jsonl) {
    return structuredClone(entry.jsonl) as T[];
  }
  const out: Record<string, unknown>[] = [];
  const lines = entry.text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      throw new Error(`分析文件 JSONL 格式损坏：${file}，第 ${i + 1} 行`);
    }
  }
  entry.jsonl = out;
  return structuredClone(out) as T[];
}
