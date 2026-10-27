/** Content identity and immutable history shared by every chapter write path. */
import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { assertResourceId } from "./primitives.js";

export function chapterRevision(chapter: { body: string; outline: unknown; position: number }) {
    return createHash("sha256").update(JSON.stringify([chapter.body, chapter.outline, chapter.position])).digest("hex");
}

/** Called under the work lock, before changing authoritative files. */
export async function preserveChapter(dir: string, id: string, expectedHash: string) {
    const source = path.join(dir, "chapters", `${assertResourceId(id)}.md`);
    const bytes = await readFile(source);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (hash !== expectedHash) throw new ZhizhangError("revision_conflict", "原稿在准备修订期间变化，未覆盖。");
    const folder = path.join(dir, "revisions", id);
    // Preserve lexical paths; do not resolve away linked ancestors.
    const chain: string[] = [];
    for (let p = folder; ; p = path.dirname(p)) { chain.push(p); if (p === path.dirname(p)) break; }
    for (const p of chain.reverse()) {
        try { const st = await lstat(p); if (st.isSymbolicLink() || !st.isDirectory()) throw new ZhizhangError("unsafe_history_path", `历史目录不是普通目录：${p}`); }
        catch (err: any) { if (err?.code !== "ENOENT") throw err; await mkdir(p); }
    }
    const relative = `revisions/${id}/${hash}.md`;
    const file = path.join(dir, relative);
    try {
        const h = await open(file, "wx", 0o600);
        try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
    } catch (err: any) {
        if (err?.code !== "EEXIST") throw err;
        const st = await lstat(file);
        if (!st.isFile() || st.isSymbolicLink() || !(await readFile(file)).equals(bytes))
            throw new ZhizhangError("history_conflict", "历史副本不完整或已变化，未覆盖原稿。");
    }
    return relative;
}
