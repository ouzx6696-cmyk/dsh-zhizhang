/**
 * mtime+size 校验的进程内文件读缓存。
 *
 * 为什么安全：本插件所有落盘都走 atomicWrite（tmp + rename 覆盖），任何一次写
 * 都会换掉文件的 mtime/size，stat 比对即可判失效——不会读到写完后的旧内容。
 * 外部进程直接改文件的场景同理（rename/写入都会更新 mtime）。
 *
 * 为什么需要：Web 面板每 ~6s 轮询一次 snapshot，而一次 snapshot 会遍历候选、
 * 拆书卡、灵感会话、分析 bundle 等大量小 JSON；不加缓存等于每次轮询全库重读。
 * （既有先例：store.ts 的 chapterLensCache 用同一模式省掉逐章重读。）
 */
import { readFile, stat } from "node:fs/promises";

interface CacheEntry {
    mtimeMs: number;
    size: number;
    text: string;
}

const MAX_ENTRIES = 800;
const textCache = new Map<string, CacheEntry>();

function remember(file: string, entry: CacheEntry) {
    // 先 delete 再 set 把键移到最新；淘汰时从最旧开始（近似 LRU）。
    textCache.delete(file);
    textCache.set(file, entry);
    if (textCache.size > MAX_ENTRIES) {
        const oldest = textCache.keys().next().value;
        if (oldest !== undefined)
            textCache.delete(oldest);
    }
}

/** 读文本；文件未变（mtime+size 一致）时命中缓存。文件不存在时向上抛 ENOENT。 */
export async function readTextCached(file: string): Promise<string> {
    const st = await stat(file);
    const hit = textCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size)
        return hit.text;
    const text = await readFile(file, "utf8");
    remember(file, { mtimeMs: st.mtimeMs, size: st.size, text });
    return text;
}

/** readTextCached + JSON.parse；解析失败照常抛错（坏文件不缓存）。 */
export async function readJsonCached<T = any>(file: string): Promise<T> {
    return JSON.parse(await readTextCached(file)) as T;
}

/** JSONL 逐行解析，同样走 mtime 缓存；空/缺/坏文件返回 []（与旧 readJsonl 语义一致）。 */
export async function readJsonlCached(file: string): Promise<any[]> {
    let raw: string;
    try {
        raw = await readTextCached(file);
        const out = [];
        for (const line of raw.split("\n")) {
            const t = line.trim();
            if (t)
                out.push(JSON.parse(t));
        }
        return out;
    }
    catch {
        return [];
    }
}
