/** Recoverable library card acceptance. Its callers hold the library write lock. */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { NovelError } from "../errors.js";
import { assertResourceId, atomicWrite, isMissingFileError } from "./primitives.js";
import { withResourceLock } from "./process-lock.js";
import { ensureRecoveryOwnerInactive, snapshotFile } from "./recovery-common.js";
import { assertNoPendingSource } from "./source-journal.js";
import { assertNoPendingDiscard } from "./discard-journal.js";
import { assertNoPendingAnalysis } from "./analysis-journal.js";
import { assertNoPendingPlan } from "./plan-journal.js";

const JOURNAL = ".writer-card-pending.json";
const hash = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const validHash = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
type Snapshot = string | null;
type Write = { file: string; before: Snapshot; after: string; content: string };
type SourceGuard = { sourceId: string; sourceFile: string; metaHash: string; sourceHash: string };
interface Journal {
    version: 1; id: string; owner: { pid: number; host: string }; createdAt: string;
    candidateId: string; cardId: string; writes: Write[]; sourceGuard?: SourceGuard;
}
function expectedFiles(candidateId: string, cardId: string) {
    return [`cards/${cardId}.json`, "index.json", `candidates/${candidateId}.json`];
}
export async function assertNoPendingCard(library: string) {
    await assertNoPendingSource(library);
    await assertNoPendingDiscard(library);
    await assertNoPendingAnalysis(library);
    await assertNoPendingPlan(library);
    try { await lstat(path.join(library, JOURNAL)); }
    catch (err) { if (isMissingFileError(err)) return; throw err; }
    throw new NovelError("library_recovery_required", "拆书库有未完成的卡采纳。请先用 fanqie_library_list(recovery=inspect) 检查，再决定是否 recovery=resume；不要重复采纳。");
}
async function readJournal(library: string): Promise<Journal> {
    let raw: string;
    try {
        const file = path.join(library, JOURNAL);
        const st = await lstat(file);
        if (!st.isFile() || st.isSymbolicLink()) throw new NovelError("library_recovery_invalid", "恢复记录不是普通文件，请保留原样并人工核对。");
        raw = await readFile(file, "utf8");
    }
    catch (err) {
        if (isMissingFileError(err)) throw new NovelError("no_pending_card", "拆书库没有待恢复的卡采纳。");
        throw err;
    }
    let j: Journal;
    try { j = JSON.parse(raw); }
    catch { throw new NovelError("library_recovery_invalid", "卡采纳恢复记录损坏；请保留文件并人工核对。"); }
    try {
        if (!j || j.version !== 1 || !/^[0-9a-f-]{36}$/.test(j.id) || !j.owner ||
            !Number.isSafeInteger(j.owner.pid) || j.owner.pid <= 0 || typeof j.owner.host !== "string" || typeof j.createdAt !== "string") throw new Error();
        const cand = assertResourceId(j.candidateId, "卡候选 id");
        const card = assertResourceId(j.cardId, "卡 id");
        const expected = expectedFiles(cand, card);
        if (!Array.isArray(j.writes) || j.writes.length !== expected.length) throw new Error();
        for (let i = 0; i < expected.length; i++) {
            const w = j.writes[i];
            if (!w || w.file !== expected[i] || !(w.before === null || validHash(w.before)) ||
                !validHash(w.after) || typeof w.content !== "string" || hash(w.content) !== w.after) throw new Error();
        }
        if (j.writes[0].before !== null) throw new Error();
        if (j.sourceGuard) {
            const g = j.sourceGuard;
            if (!/^src-[A-Za-z0-9_-]{1,64}$/.test(g.sourceId) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(g.sourceFile) ||
                !validHash(g.metaHash) || !validHash(g.sourceHash)) throw new Error();
        }
    }
    catch { throw new NovelError("library_recovery_invalid", "卡采纳恢复记录格式或校验不正确；请保留原文件，人工核对。"); }
    return j;
}
async function classify(library: string, j: Journal) {
    const writes = await Promise.all(j.writes.map(async (w) => {
        const current = await snapshotFile(path.join(library, w.file));
        return { file: w.file, state: current === w.after ? "已写入" : current === w.before ? "待写入" : "冲突" };
    }));
    const guards: Array<{ file: string; state: string }> = [];
    if (j.sourceGuard) {
        for (const [file, expected] of [
            [`sources/${j.sourceGuard.sourceId}.json`, j.sourceGuard.metaHash],
            [`sources/${j.sourceGuard.sourceFile}`, j.sourceGuard.sourceHash],
        ]) guards.push({ file, state: await snapshotFile(path.join(library, file)) === expected ? "未变化" : "冲突" });
    }
    return { writes, guards, conflict: [...writes, ...guards].some((x) => x.state === "冲突") };
}
export async function createCardJournal(library: string, input: {
    candidateId: string; cardId: string;
    writes: Array<{ file: string; before: Snapshot; content: string }>;
    sourceGuard?: SourceGuard;
}) {
    const j: Journal = {
        version: 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(),
        candidateId: input.candidateId, cardId: input.cardId,
        writes: input.writes.map((w) => ({ ...w, after: hash(w.content) })),
        ...(input.sourceGuard ? { sourceGuard: input.sourceGuard } : {}),
    };
    const file = path.join(library, JOURNAL);
    let handle;
    try { handle = await open(file, "wx", 0o600); }
    catch (err: any) {
        if (err?.code === "EEXIST") throw new NovelError("library_recovery_required", "已有未完成卡采纳，请先用 fanqie_library_list(recovery=inspect) 查看。");
        throw err;
    }
    try { await handle.writeFile(JSON.stringify(j, null, 2) + "\n", "utf8"); await handle.sync(); }
    catch (err) { await handle.close(); await unlink(file).catch(() => {}); throw err; }
    await handle.close();
    return j.id;
}
async function applyJournal(library: string, j: Journal) {
    const state = await classify(library, j);
    if (state.conflict)
        throw new NovelError("library_recovery_conflict", `以下文件已变化，未自动恢复：${[...state.writes, ...state.guards].filter((x) => x.state === "冲突").map((x) => x.file).join("、")}。请保留记录并人工核对。`);
    for (let i = 0; i < j.writes.length; i++) {
        const w = j.writes[i];
        if (state.writes[i].state === "已写入") continue;
        if (await snapshotFile(path.join(library, w.file)) !== w.before)
            throw new NovelError("library_recovery_conflict", `${w.file} 在恢复期间发生变化，已停止；请人工核对。`);
        await atomicWrite(path.join(library, w.file), w.content);
    }
    const verified = await classify(library, j);
    if (verified.conflict || verified.writes.some((w) => w.state !== "已写入"))
        throw new NovelError("library_recovery_conflict", "拆书库文件在写入期间发生变化，恢复记录已保留；请人工核对。");
    const current = await readJournal(library);
    if (current.id !== j.id) throw new NovelError("library_recovery_conflict", "恢复记录在处理期间变化，未删除记录。");
    await unlink(path.join(library, JOURNAL));
}
export async function finishCardJournal(library: string, id: string) {
    const j = await readJournal(library);
    if (j.id !== id) throw new NovelError("library_recovery_conflict", "卡采纳恢复记录已变化，未继续写入。");
    await applyJournal(library, j);
}
export async function inspectPendingCard(library: string) {
    const j = await readJournal(library);
    return { id: j.id, candidateId: j.candidateId, cardId: j.cardId, createdAt: j.createdAt, ...await classify(library, j) };
}
export async function resumePendingCard(library: string) {
    const first = await readJournal(library);
    return withResourceLock(library, async () => {
        const j = await readJournal(library);
        if (j.id !== first.id) throw new NovelError("library_recovery_conflict", "恢复记录已变化，请重新检查。");
        ensureRecoveryOwnerInactive(j.owner);
        await applyJournal(library, j);
        return { candidateId: j.candidateId, cardId: j.cardId };
    });
}
