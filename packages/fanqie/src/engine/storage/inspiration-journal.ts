import { applyRecordedWrites } from "./recovery-common.js";
/** Recover an inspiration apply across the work and inspiration directories. */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { NovelError } from "../errors.js";
import type { StoragePaths } from "../types.js";
import { assertResourceId, isMissingFileError } from "./primitives.js";
import { ensureRecoveryOwnerInactive, snapshotFile } from "./recovery-common.js";
import { withResourceLock } from "./process-lock.js";

const JOURNAL = ".writer-inspiration-pending.json";
const MARKER = ".writer-inspiration-pending.json";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Write = { target: "work" | "inspiration"; file: string; before: string | null; after: string; content: string };
type Intent = { version: 1; id: string; owner: { pid: number; host: string }; createdAt: string; workRoot: string; workKey: string; candidateId: string; chapterId?: string; writes: Write[] };
const isHash = (x: unknown) => typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
function workDir(paths: StoragePaths, key: string) { return path.join(paths.works, assertResourceId(key, "作品 key")); }
function absolute(paths: StoragePaths, j: Intent, w: Write) { return path.join(w.target === "work" ? workDir(paths, j.workKey) : paths.inspiration, w.file); }

export async function assertNoPendingInspiration(inspiration: string) {
    try { await lstat(path.join(inspiration, JOURNAL)); }
    catch (err) { if (isMissingFileError(err)) return; throw err; }
    throw new NovelError("inspiration_recovery_required", "灵感应用尚未完成。请用 fanqie_inspire_status(recovery=inspect) 检查，再决定是否恢复；不要重复应用。");
}
export async function assertNoInspirationMarker(dir: string) {
    try { await lstat(path.join(dir, MARKER)); }
    catch (err) { if (isMissingFileError(err)) return; throw err; }
    throw new NovelError("recovery_required", "作品有未完成的灵感应用。请用 fanqie_inspire_status(recovery=inspect) 检查，再决定是否恢复；不要重复应用。");
}
async function readIntent(paths: StoragePaths): Promise<Intent> {
    let raw: string;
    try {
        const file = path.join(paths.inspiration, JOURNAL);
        const st = await lstat(file);
        if (!st.isFile() || st.isSymbolicLink()) throw new Error("not a regular file");
        raw = await readFile(file, "utf8");
    } catch (err) {
        if (isMissingFileError(err)) throw new NovelError("no_pending_inspiration", "没有待恢复的灵感应用。");
        throw new NovelError("inspiration_recovery_invalid", "灵感恢复记录不可读，请保留并人工核对。");
    }
    try {
        const j: Intent = JSON.parse(raw);
        if (j.version !== 1 || !/^[a-f0-9-]{36}$/.test(j.id) || !j.owner || !Number.isSafeInteger(j.owner.pid) || j.owner.pid < 1 || typeof j.owner.host !== "string" || typeof j.createdAt !== "string") throw Error();
        if (j.workRoot !== path.resolve(paths.works)) throw Error();
        assertResourceId(j.workKey, "作品 key"); assertResourceId(j.candidateId, "候选 id");
        const expected: Array<[string, string]> = [];
        if (j.chapterId) expected.push(["work", `chapters/${assertResourceId(j.chapterId, "章节 id")}.md`]);
        expected.push(["work", "meta.json"]);
        if (j.writes?.some(w => w.target === "inspiration" && w.file === "bindings.json")) expected.push(["inspiration", "bindings.json"]);
        expected.push(["inspiration", `candidates/${j.candidateId}.json`]);
        if (!Array.isArray(j.writes) || j.writes.length !== expected.length) throw Error();
        for (let i = 0; i < expected.length; i++) {
            const w = j.writes[i];
            if (!w || w.target !== expected[i][0] || w.file !== expected[i][1] || !(w.before === null || isHash(w.before)) || !isHash(w.after) || typeof w.content !== "string" || hash(w.content) !== w.after) throw Error();
        }
        return j;
    } catch { throw new NovelError("inspiration_recovery_invalid", "灵感恢复记录格式或校验损坏，请保留原文件并人工核对。"); }
}
async function classify(paths: StoragePaths, j: Intent) {
    const writes = await Promise.all(j.writes.map(async w => {
        const current = await snapshotFile(absolute(paths, j, w));
        return { target: w.target, file: w.file, state: current === w.after ? "已写入" : current === w.before ? "待写入" : "冲突" };
    }));
    return { writes, conflict: writes.some(w => w.state === "冲突") };
}
async function createMarker(paths: StoragePaths, j: Intent) {
    const marker = path.join(workDir(paths, j.workKey), MARKER);
    try {
        const h = await open(marker, "wx", 0o600);
        try { await h.writeFile(JSON.stringify({ id: j.id }) + "\n"); await h.sync(); } finally { await h.close(); }
    } catch (err: any) {
        if (err?.code !== "EEXIST") throw err;
        let existing: any;
        try { const st = await lstat(marker); if (!st.isFile() || st.isSymbolicLink()) throw Error(); existing = JSON.parse(await readFile(marker, "utf8")); } catch { throw new NovelError("inspiration_recovery_invalid", "作品恢复标记不可读，请保留并核对。"); }
        if (existing.id !== j.id) throw new NovelError("inspiration_recovery_conflict", "作品有另一份恢复标记，请保留并核对。");
    }
}
export async function createInspirationJournal(paths: StoragePaths, input: { workKey: string; candidateId: string; chapterId?: string; writes: Array<{ target: "work" | "inspiration"; file: string; before: string | null; content: string }> }) {
    const j: Intent = { version: 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(), workRoot: path.resolve(paths.works), ...input, writes: input.writes.map(w => ({ ...w, after: hash(w.content) })) };
    const file = path.join(paths.inspiration, JOURNAL);
    let h;
    try { h = await open(file, "wx", 0o600); } catch (err: any) { if (err?.code === "EEXIST") throw new NovelError("inspiration_recovery_required", "已有未完成灵感应用，请先检查恢复记录。"); throw err; }
    try { await h.writeFile(JSON.stringify(j, null, 2) + "\n"); await h.sync(); }
    catch (err) { await h.close(); await unlink(file).catch(() => { }); throw err; }
    await h.close();
    await createMarker(paths, j);
    return j.id;
}
async function applyIntent(paths: StoragePaths, j: Intent) {
    await createMarker(paths, j);
    let state = await classify(paths, j);
    if (state.conflict) throw new NovelError("inspiration_recovery_conflict", `文件已变化，未覆盖：${state.writes.filter(w => w.state === "冲突").map(w => `${w.target}/${w.file}`).join("、")}。请保留并核对。`);
    await applyRecordedWrites(j.writes.map(w => ({ ...w, file: absolute(paths, j, w) })), "inspiration_recovery_conflict");
    state = await classify(paths, j);
    if (state.conflict || state.writes.some(w => w.state !== "已写入")) throw new NovelError("inspiration_recovery_conflict", "文件在恢复期间变化，请保留记录并人工核对。");
    if ((await readIntent(paths)).id !== j.id) throw new NovelError("inspiration_recovery_conflict", "恢复记录已变化，未清除。");
    const marker = path.join(workDir(paths, j.workKey), MARKER);
    const mark = JSON.parse(await readFile(marker, "utf8"));
    if (mark.id !== j.id) throw new NovelError("inspiration_recovery_conflict", "作品恢复标记已变化，未清除。");
    await unlink(marker);
    await unlink(path.join(paths.inspiration, JOURNAL));
}
export async function finishInspirationJournal(paths: StoragePaths, id: string) {
    const j = await readIntent(paths);
    if (j.id !== id) throw new NovelError("inspiration_recovery_conflict", "恢复记录已变化，未继续。");
    await applyIntent(paths, j);
}
export async function inspectPendingInspiration(paths: StoragePaths) {
    const j = await readIntent(paths);
    return { id: j.id, workKey: j.workKey, candidateId: j.candidateId, createdAt: j.createdAt, ...await classify(paths, j) };
}
export async function resumePendingInspiration(paths: StoragePaths) {
    return withResourceLock(paths.inspiration, async () => {
        const j = await readIntent(paths);
        return withResourceLock(workDir(paths, j.workKey), async () => {
            const current = await readIntent(paths);
            if (current.id !== j.id) throw new NovelError("inspiration_recovery_conflict", "恢复记录已变化，请重新检查。");
            ensureRecoveryOwnerInactive(j.owner);
            await applyIntent(paths, current);
            return { workKey: j.workKey, candidateId: j.candidateId };
        });
    });
}
