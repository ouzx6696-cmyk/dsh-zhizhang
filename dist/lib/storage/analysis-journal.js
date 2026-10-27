/** Recover a facts or analysis aggregate update together with its progress metadata. */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { atomicWrite, isMissingFileError } from "./primitives.js";
import { snapshotFile, ensureRecoveryOwnerInactive } from "./accept-journal.js";
import { withResourceLock } from "./process-lock.js";
const FILE = ".zhizhang-analysis-pending.json";
const hash = (s) => createHash("sha256").update(s).digest("hex");
const allowed = new Set(["chapters.jsonl", "plots.jsonl", "rhythms.json", "characters.json"]);
export async function hasPendingAnalysis(library) { try {
    await lstat(path.join(library, FILE));
    return true;
}
catch (err) {
    if (isMissingFileError(err))
        return false;
    throw err;
} }
export async function assertNoPendingAnalysis(library) { if (await hasPendingAnalysis(library))
    throw new ZhizhangError("library_recovery_required", "拆书分析更新尚未完成。请用 zhizhang_library_list(recovery=inspect) 检查，再决定是否恢复。"); }
async function readIntent(library) {
    let raw;
    try {
        const file = path.join(library, FILE);
        const st = await lstat(file);
        if (!st.isFile() || st.isSymbolicLink())
            throw Error();
        raw = await readFile(file, "utf8");
    }
    catch (err) {
        if (isMissingFileError(err))
            throw new ZhizhangError("no_pending_analysis", "没有待恢复的拆书分析更新。");
        throw new ZhizhangError("library_recovery_invalid", "分析恢复记录不可读，请保留并核对。");
    }
    try {
        const j = JSON.parse(raw);
        if (j.version !== 1 || !/^[a-f0-9-]{36}$/.test(j.id) || !j.owner || !Number.isSafeInteger(j.owner.pid) || j.owner.pid < 1 || typeof j.owner.host !== "string" || typeof j.createdAt !== "string" || !/^src-[A-Za-z0-9_-]{1,64}$/.test(j.sourceId) || !allowed.has(j.dataFile))
            throw Error();
        const files = [`analyses/${j.sourceId}/${j.dataFile}`, `analyses/${j.sourceId}/meta.json`];
        if (!Array.isArray(j.writes) || j.writes.length !== 2)
            throw Error();
        for (let i = 0; i < 2; i++) {
            const w = j.writes[i];
            if (!w || w.file !== files[i] || !(w.before === null || /^[a-f0-9]{64}$/.test(w.before)) || !/^[a-f0-9]{64}$/.test(w.after) || typeof w.content !== "string" || hash(w.content) !== w.after)
                throw Error();
        }
        return j;
    }
    catch {
        throw new ZhizhangError("library_recovery_invalid", "分析恢复记录损坏，请保留并核对。");
    }
}
async function classify(library, j) { const writes = await Promise.all(j.writes.map(async (w) => { const cur = await snapshotFile(path.join(library, w.file)); return { file: w.file, state: cur === w.after ? "已写入" : cur === w.before ? "待写入" : "冲突" }; })); return { writes, conflict: writes.some(w => w.state === "冲突") }; }
export async function createAnalysisJournal(library, input) {
    const j = { version: 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(), ...input, writes: input.writes.map(w => ({ ...w, after: hash(w.content) })) };
    let h;
    try {
        h = await open(path.join(library, FILE), "wx", 0o600);
    }
    catch (err) {
        if (err?.code === "EEXIST")
            throw new ZhizhangError("library_recovery_required", "已有待恢复的分析更新，请先检查。");
        throw err;
    }
    try {
        await h.writeFile(JSON.stringify(j, null, 2) + "\n");
        await h.sync();
    }
    catch (err) {
        await h.close();
        await unlink(path.join(library, FILE)).catch(() => { });
        throw err;
    }
    await h.close();
    return j.id;
}
async function apply(library, j) {
    let state = await classify(library, j);
    if (state.conflict)
        throw new ZhizhangError("library_recovery_conflict", `以下分析文件已变化，未覆盖：${state.writes.filter(w => w.state === "冲突").map(w => w.file).join("、")}。`);
    for (let i = 0; i < j.writes.length; i++) {
        const w = j.writes[i];
        if (state.writes[i].state === "已写入")
            continue;
        const file = path.join(library, w.file);
        if (await snapshotFile(file) !== w.before)
            throw new ZhizhangError("library_recovery_conflict", `${w.file} 在恢复期间变化。`);
        await atomicWrite(file, w.content);
    }
    state = await classify(library, j);
    if (state.conflict || state.writes.some(w => w.state !== "已写入"))
        throw new ZhizhangError("library_recovery_conflict", "分析文件在恢复期间变化，请保留记录并核对。");
    if ((await readIntent(library)).id !== j.id)
        throw new ZhizhangError("library_recovery_conflict", "分析恢复记录已变化。");
    await unlink(path.join(library, FILE));
}
export async function finishAnalysisJournal(library, id) {
    const j = await readIntent(library);
    if (j.id !== id)
        throw new ZhizhangError("library_recovery_conflict", "分析恢复记录已变化。");
    await apply(library, j);
}
export async function inspectPendingAnalysis(library) {
    const j = await readIntent(library);
    return { id: j.id, sourceId: j.sourceId, dataFile: j.dataFile, createdAt: j.createdAt, ...await classify(library, j) };
}
export async function resumePendingAnalysis(library) {
    return withResourceLock(library, async () => {
        const j = await readIntent(library);
        ensureRecoveryOwnerInactive(j.owner);
        await apply(library, j);
        return { sourceId: j.sourceId, dataFile: j.dataFile };
    });
}
