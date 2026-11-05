/** 拆书分析 — 路径 / JSON IO 基元。 */
import path from "node:path";
import { mkdir } from "node:fs/promises";

import { readJsonCached, readJsonlCached } from "../../file-cache.js";
import type { StoragePaths } from "../../types.js";

import { assertSourceId } from "../../storage/primitives.js";
import { isMissingFileError } from "../../../../../core/src/fsx.js";
export { assertSourceId } from "../../storage/primitives.js";

export { nowIso } from "../../storage/primitives.js";

export function analysisPaths(paths: StoragePaths, sourceId: string) {
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

/** 带缺失兜底的 JSON 读；T 由调用方按落盘契约声明。 */
export async function readJson<T>(file: string, fallback: T): Promise<T> {
    try {
        // mtime 缓存：分析 bundle 在面板轮询里被反复整读，未变时直接命中。
        return await readJsonCached<T>(file);
    }
    catch (err) {
        if (!isMissingFileError(err)) throw err;
        return fallback;
    }
}

export async function readJsonl<T = Record<string, unknown>>(file: string) {
    return readJsonlCached<T>(file);
}

export async function ensureDir(dir: string) {
    await mkdir(dir, { recursive: true });
    return dir;
}
