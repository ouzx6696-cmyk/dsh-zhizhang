/** Work metadata shared by chapter storage and the public store facade. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NovelError } from "../errors.js";
import { readPlanning } from "../domain/planning.js";
import { STORY_PACES } from "../domain/workflow.js";
import { EMPTY_FOUNDATION } from "../types.js";
import type { Foundation, WorkMeta } from "../types.js";
import { assertNoPendingAccept } from "./accept-journal.js";
import { atomicWrite, nowIso } from "./primitives.js";
/** Optional story pace is set only by an explicit author choice. */
export function validateStoryPace(value: unknown): WorkMeta["pace"] {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string" || !(STORY_PACES as readonly string[]).includes(value))
        throw new NovelError("bad_args", "节奏只支持快爽 / 稳推 / 慢燃");
    return value as WorkMeta["pace"];
}
export function metaPath(dir: string) {
    return path.join(dir, "meta.json");
}
export function normalizeFoundation(value: unknown): Foundation {
    const base = EMPTY_FOUNDATION();
    if (value === undefined || value === null) return base;
    const raw=asObject(value);
    return {
        ...raw,
        locks: (asString(raw, "locks", {trim:false}) ?? ""),
        happened: (asString(raw, "happened", {trim:false}) ?? ""),
        characters: (asString(raw, "characters", {trim:false}) ?? ""),
        readerKnowledge: (asString(raw, "readerKnowledge", {trim:false}) ?? ""),
        planned: (asString(raw, "planned", {trim:false}) ?? ""),
        threads: (asString(raw, "threads", {trim:false}) ?? ""),
        style: (asString(raw, "style", {trim:false}) ?? ""),
    };
}
export async function readWorkMeta(dir: string):Promise<WorkMeta> {
    await assertNoPendingAccept(dir);
    const raw = await readFile(metaPath(dir), "utf8");
    return parseWorkMeta(JSON.parse(raw), metaPath(dir));
}
export function parseWorkMeta(raw:unknown, file:string):WorkMeta {
    const meta = raw as WorkMeta;
    if (!meta || typeof meta !== "object" || Array.isArray(meta))
        throw new NovelError("bad_work_meta", `作品元数据格式损坏：${file}`);
    if (meta.chapters !== undefined && !Array.isArray(meta.chapters))
        throw new NovelError("bad_work_meta", `作品章节目录格式损坏：${file}`);
    if (meta.foundation != null && (typeof meta.foundation !== "object" || Array.isArray(meta.foundation)))
        throw new NovelError("bad_work_meta", `作品根基格式损坏：${file}`);
    const ids = new Set();
    for (const chapter of meta.chapters ?? []) {
        if (!chapter || typeof chapter.id !== "string" || ids.has(chapter.id) || typeof chapter.position !== "number" || !Number.isFinite(chapter.position))
            throw new NovelError("bad_work_meta", "章节目录条目损坏或重复，请保留原元数据核对。");
        ids.add(chapter.id);
    }
    if (meta.revisionImpacts !== undefined && !Array.isArray(meta.revisionImpacts))
        throw new NovelError("bad_work_meta", "修订影响记录格式损坏。");
    readPlanning(meta);
    if (meta.continuity !== undefined && (!meta.continuity || meta.continuity.schemaVersion !== 1 || !Array.isArray(meta.continuity.finalized) || !Array.isArray(meta.continuity.working)))
        throw new NovelError("bad_work_meta", "接续索引格式损坏。");
    meta.foundation = normalizeFoundation(meta.foundation);
    meta.chapters = meta.chapters ?? [];
    return meta;
}
export async function writeWorkMeta(dir: string, meta: any) {
    meta.updatedAt = nowIso();
    await atomicWrite(metaPath(dir), JSON.stringify(meta, null, 2) + "\n");
}

import { asString, asObject } from "../parse.js";
