/** 拆书分析 — 路径 / JSON IO 基元。 */
import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { atomicWrite } from "../../store.js";
import type { StoragePaths } from "../../types.js";
import { ZhizhangError } from "../../errors.js";

const SOURCE_ID_RE = /^src-[A-Za-z0-9_-]{1,64}$/;

export function assertSourceId(id: string) {
    const t = String(id ?? "").trim();
    if (!SOURCE_ID_RE.test(t))
        throw new ZhizhangError("bad_args", `sourceId 非法：${t.slice(0, 80)}`);
    return t;
}

export function nowIso() {
    return new Date().toISOString();
}

export function analysisPaths(paths: StoragePaths, sourceId: any) {
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

export async function readJson(file: string, fallback: any) {
    try {
        return JSON.parse(await readFile(file, "utf8"));
    }
    catch {
        return fallback;
    }
}

export async function readJsonl(file: string) {
    try {
        const raw = await readFile(file, "utf8");
        return raw
            .split("\n")
            .map((l: any) => l.trim())
            .filter(Boolean)
            .map((l: any) => JSON.parse(l));
    }
    catch {
        return [];
    }
}

export async function writeJsonl(file: string, rows: any) {
    const body = rows.map((r: any) => JSON.stringify(r)).join("\n");
    await atomicWrite(file, body ? `${body}\n` : "");
}

export async function ensureDir(dir: string) {
    await mkdir(dir, { recursive: true });
    return dir;
}
