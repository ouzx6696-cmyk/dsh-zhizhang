import { sha256 } from "../../../../core/src/fsx.js";
/** Content identity and immutable history shared by every chapter write path. */

import { lstat, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NovelError } from "../errors.js";
import { assertResourceId, createExclusive } from "./primitives.js";

export function chapterRevision(chapter: { body: string; outline: unknown; position: number }) {
    return sha256(JSON.stringify([chapter.body, chapter.outline, chapter.position]));
}

/** Called under the work lock, before changing authoritative files. */
export async function preserveChapter(dir: string, id: string, expectedHash: string) {
    const source = path.join(dir, "chapters", `${assertResourceId(id)}.md`);
    const bytes = await readFile(source);
    const hash = sha256(bytes);
    if (hash !== expectedHash) throw new NovelError("revision_conflict", "原稿在准备修订期间变化，未覆盖。");
    const folder = path.join(dir, "revisions", id);
    // Preserve lexical paths; do not resolve away linked ancestors.
    const chain: string[] = [];
    for (let p = folder; ; p = path.dirname(p)) { chain.push(p); if (p === path.dirname(p)) break; }
    for (const p of chain.reverse()) {
        try { const st = await lstat(p); if (st.isSymbolicLink() || !st.isDirectory()) throw new NovelError("unsafe_history_path", `历史目录不是普通目录：${p}`); }
        catch (err: any) { if (err?.code !== "ENOENT") throw err; await mkdir(p); }
    }
    const relative = `revisions/${id}/${hash}.md`;
    const file = path.join(dir, relative);
    try {
        await createExclusive(file, bytes);
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        const st = await lstat(file);
        if (!st.isFile() || st.isSymbolicLink() || !(await readFile(file)).equals(bytes))
            throw new NovelError("history_conflict", "历史副本不完整或已变化，未覆盖原稿。");
    }
    return relative;
}
