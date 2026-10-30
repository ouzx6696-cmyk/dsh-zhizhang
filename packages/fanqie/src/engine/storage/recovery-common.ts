/** Shared recovery primitives; operation modules retain format and target whitelists. */
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { lstat, readFile, unlink } from "node:fs/promises";
import { NovelError } from "../errors.js";
import { atomicWrite, isMissingFileError } from "./primitives.js";
type Snapshot = string | null;
const hash = (value: Buffer) => createHash("sha256").update(value).digest("hex");
export async function snapshotFile(file: string): Promise<Snapshot> {
    try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink())
            throw new NovelError("recovery_unsupported_file", `不能通过恢复流程覆盖非普通文件或符号链接：${file}`);
        return hash(await readFile(file));
    }
    catch (err) { if (isMissingFileError(err)) return null; throw err; }
}

export function ensureRecoveryOwnerInactive(owner: { pid: number; host: string }) {
    if (owner.host !== hostname())
        throw new NovelError("recovery_owner_unknown", "恢复记录来自另一台主机，无法确认原进程已停止；请先由管理员核对，暂不自动恢复。");
    if (owner.pid === process.pid) return; // caller holds the operation's process-local locks
    try { process.kill(owner.pid, 0); }
    catch (err: any) { if (err?.code === "ESRCH") return; throw new NovelError("recovery_owner_unknown", "无法确认原进程是否停止，暂不自动恢复。"); }
    throw new NovelError("recovery_owner_active", "原进程仍存在（或进程号已复用），暂不自动恢复；请先核对原进程状态。");
}


export interface RecordedWrite { file: string; before: string | null; after: string | null; content?: string }
export async function applyRecordedWrites(writes: RecordedWrite[], code: string) {
    const current = await Promise.all(writes.map(w => snapshotFile(w.file)));
    if (writes.some((w, i) => current[i] !== w.before && current[i] !== w.after))
        throw new NovelError(code, "文件与记录基线冲突，未继续写入；请保留现有文件与恢复记录。");
    for (const w of writes) {
        const now = await snapshotFile(w.file);
        if (now === w.after) continue;
        if (now !== w.before) throw new NovelError(code, `${w.file} 在恢复期间变化，已停止。`);
        if (w.after === null) await unlink(w.file);
        else {
            if (typeof w.content !== "string" || createHash("sha256").update(w.content).digest("hex") !== w.after)
                throw new NovelError(code, "恢复内容校验不正确。");
            await atomicWrite(w.file, w.content);
        }
    }
    if ((await Promise.all(writes.map(w => snapshotFile(w.file)))).some((v, i) => v !== writes[i].after))
        throw new NovelError(code, "写入后的文件变化，恢复记录已保留。");
}
