import { applyRecordedWrites } from "./recovery-common.js";
/** Recover a direct chapter or outline save interrupted between chapter and metadata. */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { assertResourceId, isMissingFileError } from "./primitives.js";
import { ensureRecoveryOwnerInactive, snapshotFile } from "./recovery-common.js";
import { withResourceLock } from "./process-lock.js";
const FILE = ".zhizhang-chapter-pending.json";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Write = { file: string; before: string | null; after: string; content: string };
type Intent = { version: 1 | 2 | 3 | 4 | 5; id: string; owner: { pid: number; host: string }; createdAt: string; chapterId: string; kind?: "brief" | "payoff" | "lint" | "stage"; candidateId?: string; writes: Write[] };
export async function hasPendingChapterSave(dir: string) { try { await lstat(path.join(dir, FILE)); return true; } catch (err) { if (isMissingFileError(err)) return false; throw err; } }
export async function assertNoPendingChapterSave(dir: string) { if (await hasPendingChapterSave(dir)) throw new ZhizhangError("recovery_required", "作品有未完成的章节、候选或留痕操作。请用 zhizhang_status(work=作品, recovery=inspect) 检查，再决定是否恢复。"); }
async function readIntent(dir: string): Promise<Intent> {
    let raw: string;
    try { const file = path.join(dir, FILE); const st = await lstat(file); if (!st.isFile() || st.isSymbolicLink()) throw Error(); raw = await readFile(file, "utf8"); }
    catch (err) { if (isMissingFileError(err)) throw new ZhizhangError("no_pending_chapter", "没有待恢复的章节保存。"); throw new ZhizhangError("recovery_invalid", "章节保存恢复记录不可读，请保留并核对。"); }
    try {
        const j: Intent = JSON.parse(raw);
        if (![1, 2, 3, 4, 5].includes(j.version) || !/^[a-f0-9-]{36}$/.test(j.id) || !j.owner || !Number.isSafeInteger(j.owner.pid) || j.owner.pid < 1 || typeof j.owner.host !== "string" || typeof j.createdAt !== "string" || typeof j.chapterId !== "string") throw Error();
        if (j.version === 2 && j.kind !== "brief" && j.kind !== "payoff") throw Error();
        if (j.version === 3 && j.kind !== "lint" || j.version === 4 && j.kind !== "stage") throw Error();
        const candidateId = (j.version === 3 || j.version === 4) ? assertResourceId(j.candidateId!, "候选 id") : "";
        const files = (j.version === 1 || j.version === 5) ? [`chapters/${assertResourceId(j.chapterId, "章节 id")}.md`, "meta.json", ...(j.version === 5 ? ["ledger.json"] : [])]
            : j.version === 2 ? [j.kind === "brief" ? "brief-crumbs.json" : "payoff-audits.json", "ledger.json"]
            : j.version === 3 ? [`candidates/${candidateId}.json`, "ledger.json"]
            : [`candidates/${candidateId}.md`, `candidates/${candidateId}.json`];
        if (!Array.isArray(j.writes) || j.writes.length !== files.length) throw Error();
        for (let i = 0; i < files.length; i++) { const w = j.writes[i]; if (!w || w.file !== files[i] || !(w.before === null || /^[a-f0-9]{64}$/.test(w.before)) || !/^[a-f0-9]{64}$/.test(w.after) || typeof w.content !== "string" || hash(w.content) !== w.after) throw Error(); }
        if (j.version === 4 && j.writes.some(w => w.before !== null)) throw Error();
        return j;
    } catch { throw new ZhizhangError("recovery_invalid", "章节保存恢复记录损坏，请保留并人工核对。"); }
}
async function classify(dir: string, j: Intent) { const writes = await Promise.all(j.writes.map(async w => { const current = await snapshotFile(path.join(dir, w.file)); return { file: w.file, state: current === w.after ? "已写入" : current === w.before ? "待写入" : "冲突" }; })); return { writes, conflict: writes.some(w => w.state === "冲突") }; }
export async function createChapterJournal(dir: string, input: { chapterId: string; writes: Array<{ file: string; before: string | null; content: string }> }) {
    const j: Intent = { version: input.writes.length === 3 ? 5 : 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(), chapterId: input.chapterId, writes: input.writes.map(w => ({ ...w, after: hash(w.content) })) };
    let h; try { h = await open(path.join(dir, FILE), "wx", 0o600); } catch (err: any) { if (err?.code === "EEXIST") throw new ZhizhangError("recovery_required", "已有待恢复的章节保存，请先检查。"); throw err; }
    try { await h.writeFile(JSON.stringify(j, null, 2) + "\n"); await h.sync(); } catch (err) { await h.close(); await unlink(path.join(dir, FILE)).catch(() => { }); throw err; } await h.close(); return j.id;
}
export async function createWorkRecordJournal(dir: string, input: { kind: "brief" | "payoff" | "lint" | "stage"; chapterId: string; candidateId?: string; writes: Array<{ file: string; before: string | null; content: string }> }) {
    const version = input.kind === "lint" ? 3 : input.kind === "stage" ? 4 : 2;
    const j: Intent = { version, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(), chapterId: input.chapterId, kind: input.kind, ...(input.candidateId ? { candidateId: input.candidateId } : {}), writes: input.writes.map(w => ({ ...w, after: hash(w.content) })) };
    let h; try { h = await open(path.join(dir, FILE), "wx", 0o600); } catch (err: any) { if (err?.code === "EEXIST") throw new ZhizhangError("recovery_required", "已有待恢复的留痕更新，请先检查。"); throw err; }
    try { await h.writeFile(JSON.stringify(j, null, 2) + "\n"); await h.sync(); } catch (err) { await h.close(); await unlink(path.join(dir, FILE)).catch(() => { }); throw err; } await h.close(); return j.id;
}
async function apply(dir: string, j: Intent) {
    let state = await classify(dir, j); if (state.conflict) throw new ZhizhangError("recovery_conflict", `文件已变化，未覆盖：${state.writes.filter(w => w.state === "冲突").map(w => w.file).join("、")}。`);
    await applyRecordedWrites(j.writes.map(w => ({ ...w, file: path.join(dir, w.file) })), "recovery_conflict");
    state = await classify(dir, j); if (state.conflict || state.writes.some(w => w.state !== "已写入")) throw new ZhizhangError("recovery_conflict", "文件在恢复期间变化，请保留记录并核对。");
    if ((await readIntent(dir)).id !== j.id) throw new ZhizhangError("recovery_conflict", "恢复记录已变化，未清除。"); await unlink(path.join(dir, FILE));
}
export async function finishChapterJournal(dir: string, id: string) { const j = await readIntent(dir); if (j.id !== id) throw new ZhizhangError("recovery_conflict", "恢复记录已变化。"); await apply(dir, j); }
export async function inspectPendingChapterSave(dir: string) { const j = await readIntent(dir); return { id: j.id, chapterId: j.chapterId, candidateId: j.candidateId, kind: j.kind, createdAt: j.createdAt, ...await classify(dir, j) }; }
export async function resumePendingChapterSave(dir: string) { return withResourceLock(dir, async () => { const j = await readIntent(dir); ensureRecoveryOwnerInactive(j.owner); await apply(dir, j); return { chapterId: j.chapterId, candidateId: j.candidateId, kind: j.kind }; }); }
