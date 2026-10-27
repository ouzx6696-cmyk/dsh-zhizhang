/** Recover an interrupted source import without embedding the full book in the journal. */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import { atomicWrite, isMissingFileError } from "./primitives.js";
import { snapshotFile, ensureRecoveryOwnerInactive } from "./recovery-common.js";
import { withResourceLock } from "./process-lock.js";
const FILE = ".zhizhang-source-pending.json";
const hash = (s) => createHash("sha256").update(s).digest("hex");
export async function hasPendingSource(library) { try {
    await lstat(path.join(library, FILE));
    return true;
}
catch (err) {
    if (isMissingFileError(err))
        return false;
    throw err;
} }
export async function assertNoPendingSource(library) { if (await hasPendingSource(library))
    throw new ZhizhangError("library_recovery_required", "书源导入尚未完成。请用 zhizhang_library_list(recovery=inspect) 检查，再决定是否恢复；不要重复导入。"); }
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
            throw new ZhizhangError("no_pending_source", "没有待恢复的书源导入。");
        throw new ZhizhangError("library_recovery_invalid", "书源恢复记录不可读，请保留并核对。");
    }
    try {
        const j = JSON.parse(raw);
        if (j.version !== 1 || !/^[a-f0-9-]{36}$/.test(j.id) || !j.owner || !Number.isSafeInteger(j.owner.pid) || j.owner.pid < 1 || typeof j.owner.host !== "string" || typeof j.createdAt !== "string" || !/^src-[A-Za-z0-9_-]{1,64}$/.test(j.sourceId))
            throw Error();
        if (j.stagedFile !== `sources/.${j.sourceId}.pending.txt`)
            throw Error();
        const files = [`sources/${j.sourceId}.txt`, `sources/${j.sourceId}.json`, "index.json"];
        if (!Array.isArray(j.writes) || j.writes.length !== 3)
            throw Error();
        for (let i = 0; i < 3; i++) {
            const w = j.writes[i];
            if (!w || w.file !== files[i] || !(w.before === null || /^[a-f0-9]{64}$/.test(w.before)) || !/^[a-f0-9]{64}$/.test(w.after))
                throw Error();
            if (i === 0) {
                if (w.before !== null || w.content !== undefined)
                    throw Error();
            }
            else if (typeof w.content !== "string" || hash(w.content) !== w.after)
                throw Error();
        }
        if (j.writes[1].before !== null || j.writes[2].before === null)
            throw Error();
        return j;
    }
    catch {
        throw new ZhizhangError("library_recovery_invalid", "书源导入恢复记录损坏，请保留并人工核对。");
    }
}
async function classify(library, j) {
    const writes = await Promise.all(j.writes.map(async (w) => { const current = await snapshotFile(path.join(library, w.file)); return { file: w.file, state: current === w.after ? "已写入" : current === w.before ? "待写入" : "冲突" }; }));
    const staged = await snapshotFile(path.join(library, j.stagedFile));
    const stageState = staged === j.writes[0].after ? "未变化" : writes[0].state === "已写入" && staged === null ? "已移除" : "冲突";
    return { writes, guards: [{ file: j.stagedFile, state: stageState }], conflict: writes.some(w => w.state === "冲突") || stageState === "冲突" };
}
export async function createSourceJournal(library, input) {
    if (!/^src-[A-Za-z0-9_-]{1,64}$/.test(input.sourceId))
        throw new ZhizhangError("bad_args", "书源 id 无效");
    const stagedFile = `sources/.${input.sourceId}.pending.txt`;
    const staged = path.join(library, stagedFile);
    if (await snapshotFile(staged) !== null)
        throw new ZhizhangError("id_collision", "临时书源已存在，未覆盖原文件。");
    await atomicWrite(staged, input.text);
    const j = {
        version: 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(), sourceId: input.sourceId, stagedFile, writes: [
            { file: `sources/${input.sourceId}.txt`, before: null, after: hash(input.text) },
            { file: `sources/${input.sourceId}.json`, before: null, after: hash(input.metaContent), content: input.metaContent },
            { file: "index.json", before: input.indexBefore, after: hash(input.indexContent), content: input.indexContent },
        ]
    };
    let h;
    try {
        h = await open(path.join(library, FILE), "wx", 0o600);
    }
    catch (err) {
        if (err?.code === "EEXIST")
            throw new ZhizhangError("library_recovery_required", "已有待恢复的书源导入，请先检查。");
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
        throw new ZhizhangError("library_recovery_conflict", `以下文件发生变化，未覆盖：${[...state.writes, ...state.guards].filter(x => x.state === "冲突").map(x => x.file).join("、")}。`);
    for (let i = 0; i < j.writes.length; i++) {
        const w = j.writes[i];
        if (state.writes[i].state === "已写入")
            continue;
        const file = path.join(library, w.file);
        if (await snapshotFile(file) !== w.before)
            throw new ZhizhangError("library_recovery_conflict", `${w.file} 在恢复期间变化，已停止。`);
        const content = i === 0 ? await readFile(path.join(library, j.stagedFile), "utf8") : w.content;
        if (hash(content) !== w.after)
            throw new ZhizhangError("library_recovery_conflict", `待写内容 ${w.file} 已变化，已停止。`);
        await atomicWrite(file, content);
    }
    state = await classify(library, j);
    if (state.conflict || state.writes.some(w => w.state !== "已写入"))
        throw new ZhizhangError("library_recovery_conflict", "书源文件在恢复期间变化，请保留记录并核对。");
    if ((await readIntent(library)).id !== j.id)
        throw new ZhizhangError("library_recovery_conflict", "恢复记录已变化，未清除。");
    await unlink(path.join(library, j.stagedFile)).catch((err) => { if (err?.code !== "ENOENT")
        throw err; });
    await unlink(path.join(library, FILE));
}
export async function finishSourceJournal(library, id) { const j = await readIntent(library); if (j.id !== id)
    throw new ZhizhangError("library_recovery_conflict", "书源恢复记录已变化。"); await apply(library, j); }
export async function inspectPendingSource(library) { const j = await readIntent(library); return { id: j.id, sourceId: j.sourceId, createdAt: j.createdAt, ...await classify(library, j) }; }
export async function resumePendingSource(library) { return withResourceLock(library, async () => { const j = await readIntent(library); ensureRecoveryOwnerInactive(j.owner); await apply(library, j); return { sourceId: j.sourceId }; }); }
