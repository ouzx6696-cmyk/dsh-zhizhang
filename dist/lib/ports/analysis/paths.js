/** 拆书分析 — 路径 / JSON IO 基元。 */
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWrite } from "../../store.js";
import { readJsonCached, readJsonlCached } from "../../file-cache.js";
import { ZhizhangError } from "../../errors.js";
const SOURCE_ID_RE = /^src-[A-Za-z0-9_-]{1,64}$/;
export function assertSourceId(id) {
    const t = String(id ?? "").trim();
    if (!SOURCE_ID_RE.test(t))
        throw new ZhizhangError("bad_args", `sourceId 非法：${t.slice(0, 80)}`);
    return t;
}
export function nowIso() {
    return new Date().toISOString();
}
export function analysisPaths(paths, sourceId) {
    const id = assertSourceId(sourceId);
    const dir = path.join(paths.library, "analyses", id);
    return {
        dir,
        meta: path.join(dir, "meta.json"),
        chapters: path.join(dir, "chapters.jsonl"),
        plots: path.join(dir, "plots.jsonl"),
        rhythms: path.join(dir, "rhythms.json"),
        characters: path.join(dir, "characters.json"),
        survey: path.join(dir, "survey.json"),
        report: path.join(dir, "report.md"),
    };
}
export async function readJson(file, fallback) {
    try {
        // mtime 缓存：分析 bundle 在面板轮询里被反复整读，未变时直接命中。
        return await readJsonCached(file);
    }
    catch {
        return fallback;
    }
}
export async function readJsonl(file) {
    return readJsonlCached(file);
}
export async function writeJsonl(file, rows) {
    const body = rows.map((r) => JSON.stringify(r)).join("\n");
    await atomicWrite(file, body ? `${body}\n` : "");
}
export async function ensureDir(dir) {
    await mkdir(dir, { recursive: true });
    return dir;
}
