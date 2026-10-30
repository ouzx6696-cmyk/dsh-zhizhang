import { applyRecordedWrites } from "./recovery-common.js";
/** Recover the authoritative reading plan, its human-readable view and scope together. */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { NovelError } from "../errors.js";
import { isMissingFileError } from "./primitives.js";
import { snapshotFile, ensureRecoveryOwnerInactive } from "./recovery-common.js";
import { withResourceLock } from "./process-lock.js";
const FILE = ".writer-plan-pending.json";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Write = { file: string; before: string | null; after: string | null; content?: string };
type Intent = { version: 1; id: string; owner: { pid: number; host: string }; createdAt: string; sourceId: string; clearConfirm: boolean; writes: Write[] };
export async function hasPendingPlan(library: string) { try { await lstat(path.join(library, FILE)); return true; } catch (err) { if (isMissingFileError(err)) return false; throw err; } }
export async function assertNoPendingPlan(library: string) { if (await hasPendingPlan(library)) throw new NovelError("library_recovery_required", "拆书计划更新尚未完成。请用 fanqie_library_list(recovery=inspect) 检查，再决定是否恢复。"); }
async function readIntent(library: string): Promise<Intent> {
    let raw: string; try { const file = path.join(library, FILE); const st = await lstat(file); if (!st.isFile() || st.isSymbolicLink()) throw Error(); raw = await readFile(file, "utf8"); } catch (err) { if (isMissingFileError(err)) throw new NovelError("no_pending_plan", "没有待恢复的拆书计划。"); throw new NovelError("library_recovery_invalid", "计划恢复记录不可读，请保留并核对。"); }
    try {
        const j: Intent = JSON.parse(raw); if (j.version !== 1 || !/^[a-f0-9-]{36}$/.test(j.id) || !j.owner || !Number.isSafeInteger(j.owner.pid) || j.owner.pid < 1 || typeof j.owner.host !== "string" || typeof j.createdAt !== "string" || !/^src-[A-Za-z0-9_-]{1,64}$/.test(j.sourceId) || typeof j.clearConfirm !== "boolean") throw Error();
        const base = `analyses/${j.sourceId}`; const files = [`${base}/plan.json`, `${base}/plan.md`, `${base}/meta.json`, ...(j.clearConfirm ? [`${base}/plan-confirm.json`] : [])];
        if (!Array.isArray(j.writes) || j.writes.length !== files.length) throw Error();
        for (let i = 0; i < files.length; i++) { const w = j.writes[i]; if (!w || w.file !== files[i] || !(w.before === null || /^[a-f0-9]{64}$/.test(w.before))) throw Error(); if (i === 3) { if (w.after !== null || w.content !== undefined) throw Error(); } else if (typeof w.content !== "string" || typeof w.after !== "string" || !/^[a-f0-9]{64}$/.test(w.after) || hash(w.content) !== w.after) throw Error(); }
        return j;
    } catch { throw new NovelError("library_recovery_invalid", "计划恢复记录损坏，请保留并核对。"); }
}
async function classify(library: string, j: Intent) { const writes = await Promise.all(j.writes.map(async w => { const cur = await snapshotFile(path.join(library, w.file)); return { file: w.file, state: cur === w.after ? "已完成" : cur === w.before ? "待处理" : "冲突" }; })); return { writes, conflict: writes.some(w => w.state === "冲突") }; }
export async function createPlanJournal(library: string, input: { sourceId: string; clearConfirm: boolean; writes: Array<{ file: string; before: string | null; content?: string }> }) {
    const j: Intent = { version: 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(), ...input, writes: input.writes.map(w => ({ ...w, after: w.content === undefined ? null : hash(w.content) })) };
    let h; try { h = await open(path.join(library, FILE), "wx", 0o600); } catch (err: any) { if (err?.code === "EEXIST") throw new NovelError("library_recovery_required", "已有待恢复的计划更新，请先检查。"); throw err; }
    try { await h.writeFile(JSON.stringify(j, null, 2) + "\n"); await h.sync(); } catch (err) { await h.close(); await unlink(path.join(library, FILE)).catch(() => { }); throw err; } await h.close(); return j.id;
}
async function apply(library: string, j: Intent) {
    let state = await classify(library, j);
    if (state.conflict) throw new NovelError("library_recovery_conflict", `计划文件已变化，未覆盖：${state.writes.filter(w => w.state === "冲突").map(w => w.file).join("、")}。`);
    await applyRecordedWrites(j.writes.map(w => ({ ...w, file: path.join(library, w.file) })), "library_recovery_conflict");
    state = await classify(library, j); if (state.conflict || state.writes.some(w => w.state !== "已完成")) throw new NovelError("library_recovery_conflict", "计划文件在恢复期间变化，请保留记录并核对。");
    if ((await readIntent(library)).id !== j.id) throw new NovelError("library_recovery_conflict", "计划恢复记录已变化。"); await unlink(path.join(library, FILE));
}
export async function finishPlanJournal(library: string, id: string) { const j = await readIntent(library); if (j.id !== id) throw new NovelError("library_recovery_conflict", "计划恢复记录已变化。"); await apply(library, j); }
export async function inspectPendingPlan(library: string) { const j = await readIntent(library); return { id: j.id, sourceId: j.sourceId, createdAt: j.createdAt, ...await classify(library, j) }; }
export async function resumePendingPlan(library: string) { return withResourceLock(library, async () => { const j = await readIntent(library); ensureRecoveryOwnerInactive(j.owner); await apply(library, j); return { sourceId: j.sourceId }; }); }
