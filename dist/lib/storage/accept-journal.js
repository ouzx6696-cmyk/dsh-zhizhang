import { snapshotFile, ensureRecoveryOwnerInactive, applyRecordedWrites } from "./recovery-common.js";
export { snapshotFile, ensureRecoveryOwnerInactive } from "./recovery-common.js";
/** Recoverable candidate acceptance for one work. */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { withResourceLock } from "./process-lock.js";
import { assertNoInspirationMarker } from "./inspiration-journal.js";
import { assertNoPendingChapterSave } from "./chapter-journal.js";
import { assertResourceId, isMissingFileError } from "./primitives.js";
const JOURNAL = ".zhizhang-accept-pending.json";
const hash = (s) => createHash("sha256").update(s).digest("hex");
/** A pending acceptance is never silently interpreted as a completed state. */
export async function assertNoPendingAccept(dir) {
    await assertNoInspirationMarker(dir);
    await assertNoPendingChapterSave(dir);
    try {
        await lstat(path.join(dir, JOURNAL));
    }
    catch (err) {
        if (isMissingFileError(err))
            return;
        throw err;
    }
    throw new ZhizhangError("recovery_required", "作品有未完成的章节采纳。请用 zhizhang_status(work=作品, recovery=inspect) 核对，再决定是否用 recovery=resume 恢复；不要重复采纳。");
}
function expectedFiles(chapterId, candidateId) {
    return [`chapters/${chapterId}.md`, "meta.json", `candidates/${candidateId}.json`, "ledger.json"];
}
function validHash(value) {
    return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}
async function readJournal(dir) {
    let raw;
    try {
        const file = path.join(dir, JOURNAL);
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink())
            throw new ZhizhangError("recovery_invalid", "恢复记录不是普通文件，请保留原样并人工核对。");
        raw = await readFile(file, "utf8");
    }
    catch (err) {
        if (isMissingFileError(err))
            throw new ZhizhangError("no_pending_accept", "作品没有待恢复的章节采纳。");
        throw err;
    }
    let j;
    try {
        j = JSON.parse(raw);
    }
    catch {
        throw new ZhizhangError("recovery_invalid", "采纳恢复记录损坏；请保留文件和作品原样，人工检查后恢复。");
    }
    try {
        if (!j || j.version !== 1 || !/^[0-9a-f-]{36}$/.test(j.id) || !j.owner ||
            !Number.isSafeInteger(j.owner.pid) || j.owner.pid <= 0 || typeof j.owner.host !== "string" ||
            (j.mode !== "append" && j.mode !== "replace") || typeof j.createdAt !== "string")
            throw new Error();
        const chapterId = assertResourceId(j.chapterId, "章节 id");
        const candidateId = assertResourceId(j.candidateId, "候选 id");
        const expected = expectedFiles(chapterId, candidateId);
        if (!Array.isArray(j.writes) || j.writes.length !== expected.length || !Array.isArray(j.guards) || j.guards.length !== 1)
            throw new Error();
        for (let i = 0; i < expected.length; i++) {
            const w = j.writes[i];
            if (!w || w.file !== expected[i] || !(w.before === null || validHash(w.before)) ||
                !validHash(w.after) || typeof w.content !== "string" || hash(w.content) !== w.after)
                throw new Error();
        }
        const bodyFile = j.bodyFile;
        if (typeof bodyFile !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(bodyFile))
            throw new Error();
        const g = j.guards[0];
        if (!g || g.file !== `candidates/${bodyFile}` || !validHash(g.before))
            throw new Error();
    }
    catch {
        throw new ZhizhangError("recovery_invalid", "采纳恢复记录格式或校验不正确；请保留原文件，人工核对。");
    }
    return j;
}
async function classify(dir, j) {
    const writes = await Promise.all(j.writes.map(async (w) => {
        const current = await snapshotFile(path.join(dir, w.file));
        return { file: w.file, state: current === w.after ? "已写入" : current === w.before ? "待写入" : "冲突" };
    }));
    const guards = await Promise.all(j.guards.map(async (g) => ({
        file: g.file, state: await snapshotFile(path.join(dir, g.file)) === g.before ? "未变化" : "冲突",
    })));
    return { writes, guards, conflict: [...writes, ...guards].some((x) => x.state === "冲突") };
}
/** Construct the intent before any of the four authoritative files are written. */
export async function createAcceptJournal(dir, input) {
    const j = {
        version: 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() },
        chapterId: input.chapterId, candidateId: input.candidateId, bodyFile: input.bodyFile, mode: input.mode,
        createdAt: new Date().toISOString(),
        writes: input.writes.map((w) => ({ ...w, after: hash(w.content) })),
        guards: [{ file: `candidates/${input.bodyFile}`, before: input.bodyHash }],
    };
    const file = path.join(dir, JOURNAL);
    let handle;
    try {
        handle = await open(file, "wx", 0o600);
    }
    catch (err) {
        if (err?.code === "EEXIST")
            throw new ZhizhangError("recovery_required", "已有未完成采纳，请先用 zhizhang_status 的 recovery=inspect 查看。");
        throw err;
    }
    try {
        await handle.writeFile(JSON.stringify(j, null, 2) + "\n", "utf8");
        await handle.sync();
    }
    catch (err) {
        await handle.close();
        await unlink(file).catch(() => { });
        throw err;
    }
    await handle.close();
    return j.id;
}
async function applyJournal(dir, j) {
    const state = await classify(dir, j);
    if (state.conflict)
        throw new ZhizhangError("recovery_conflict", `以下文件已变化，未自动恢复：${[...state.writes, ...state.guards].filter((x) => x.state === "冲突").map((x) => x.file).join("、")}。请保留记录并人工核对。`);
    await applyRecordedWrites(j.writes.map(w => ({ ...w, file: path.join(dir, w.file) })), "recovery_conflict");
    const verified = await classify(dir, j);
    if (verified.conflict || verified.writes.some((w) => w.state !== "已写入"))
        throw new ZhizhangError("recovery_conflict", "采纳文件在写入期间发生变化，恢复记录已保留；请人工核对。");
    const current = await readJournal(dir);
    if (current.id !== j.id)
        throw new ZhizhangError("recovery_conflict", "恢复记录在处理期间发生变化，未删除记录。");
    await unlink(path.join(dir, JOURNAL));
}
/** Called by the original writer while holding all relevant locks. */
export async function finishAcceptJournal(dir, id) {
    const j = await readJournal(dir);
    if (j.id !== id)
        throw new ZhizhangError("recovery_conflict", "采纳恢复记录已变化，未继续写入。");
    await applyJournal(dir, j);
}
export async function inspectPendingAccept(dir) {
    const j = await readJournal(dir);
    return { id: j.id, chapterId: j.chapterId, candidateId: j.candidateId, mode: j.mode, createdAt: j.createdAt, ...await classify(dir, j) };
}
export async function resumePendingAccept(dir) {
    return withResourceLock(dir, async () => {
        const j = await readJournal(dir);
        ensureRecoveryOwnerInactive(j.owner);
        await applyJournal(dir, j);
        return { chapterId: j.chapterId, candidateId: j.candidateId, mode: j.mode };
    });
}
