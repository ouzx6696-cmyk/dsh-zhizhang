/** Work metadata shared by chapter storage and the public store facade. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { readPlanning } from "../domain/planning.js";
import { STORY_PACES } from "../domain/workflow.js";
import { EMPTY_FOUNDATION } from "../types.js";
import { assertNoPendingAccept } from "./accept-journal.js";
import { atomicWrite, nowIso } from "./primitives.js";
/** Optional story pace is set only by an explicit author choice. */
export function validateStoryPace(value) {
    if (value === undefined || value === null || value === "")
        return undefined;
    if (typeof value !== "string" || !STORY_PACES.includes(value))
        throw new ZhizhangError("bad_args", "节奏只支持快爽 / 稳推 / 慢燃");
    return value;
}
export function metaPath(dir) {
    return path.join(dir, "meta.json");
}
export function normalizeFoundation(raw) {
    const base = EMPTY_FOUNDATION();
    if (!raw || typeof raw !== "object")
        return base;
    return {
        ...raw,
        locks: String(raw.locks ?? ""),
        happened: String(raw.happened ?? ""),
        characters: String(raw.characters ?? ""),
        readerKnowledge: String(raw.readerKnowledge ?? ""),
        planned: String(raw.planned ?? ""),
        threads: String(raw.threads ?? ""),
        style: String(raw.style ?? ""),
    };
}
export async function readWorkMeta(dir) {
    await assertNoPendingAccept(dir);
    const raw = await readFile(metaPath(dir), "utf8");
    const meta = JSON.parse(raw);
    if (!meta || typeof meta !== "object" || Array.isArray(meta))
        throw new ZhizhangError("bad_work_meta", `作品元数据格式损坏：${metaPath(dir)}`);
    if (meta.chapters !== undefined && !Array.isArray(meta.chapters))
        throw new ZhizhangError("bad_work_meta", `作品章节目录格式损坏：${metaPath(dir)}`);
    if (meta.foundation != null && (typeof meta.foundation !== "object" || Array.isArray(meta.foundation)))
        throw new ZhizhangError("bad_work_meta", `作品根基格式损坏：${metaPath(dir)}`);
    const ids = new Set();
    for (const chapter of meta.chapters ?? []) {
        if (!chapter || typeof chapter.id !== "string" || ids.has(chapter.id) || typeof chapter.position !== "number" || !Number.isFinite(chapter.position))
            throw new ZhizhangError("bad_work_meta", "章节目录条目损坏或重复，请保留原元数据核对。");
        ids.add(chapter.id);
    }
    if (meta.revisionImpacts !== undefined && !Array.isArray(meta.revisionImpacts))
        throw new ZhizhangError("bad_work_meta", "修订影响记录格式损坏。");
    readPlanning(meta);
    if (meta.continuity !== undefined && (!meta.continuity || meta.continuity.schemaVersion !== 1 || !Array.isArray(meta.continuity.finalized) || !Array.isArray(meta.continuity.working)))
        throw new ZhizhangError("bad_work_meta", "接续索引格式损坏。");
    meta.foundation = normalizeFoundation(meta.foundation);
    meta.chapters = meta.chapters ?? [];
    return meta;
}
export async function writeWorkMeta(dir, meta) {
    meta.updatedAt = nowIso();
    await atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
}
