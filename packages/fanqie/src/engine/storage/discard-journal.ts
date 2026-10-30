/** Recover an interrupted card discard without deleting a card changed after the request. */
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { NovelError } from "../errors.js";
import { assertResourceId, atomicWrite, isMissingFileError } from "./primitives.js";
import { snapshotFile, ensureRecoveryOwnerInactive } from "./recovery-common.js";
import { withResourceLock } from "./process-lock.js";
const FILE = ".writer-discard-pending.json";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Intent = { version: 1; id: string; owner: { pid: number; host: string }; createdAt: string; cardId: string; indexBefore: string; indexAfter: string; indexContent: string; cardBefore: string | null };
export async function hasPendingDiscard(library: string) { try { await lstat(path.join(library, FILE)); return true; } catch (err) { if (isMissingFileError(err)) return false; throw err; } }
export async function assertNoPendingDiscard(library: string) { if (await hasPendingDiscard(library)) throw new NovelError("library_recovery_required", "删卡操作尚未完成。请用 fanqie_library_list(recovery=inspect) 检查，再决定是否恢复。"); }
async function readIntent(library: string): Promise<Intent> {
    let raw: string; try { const file = path.join(library, FILE); const st = await lstat(file); if (!st.isFile() || st.isSymbolicLink()) throw Error(); raw = await readFile(file, "utf8"); } catch (err) { if (isMissingFileError(err)) throw new NovelError("no_pending_discard", "没有待恢复的删卡操作。"); throw new NovelError("library_recovery_invalid", "删卡恢复记录不可读，请保留并核对。"); }
    try { const j: Intent = JSON.parse(raw); assertResourceId(j.cardId, "卡 id"); if (j.version !== 1 || !/^[a-f0-9-]{36}$/.test(j.id) || !j.owner || !Number.isSafeInteger(j.owner.pid) || j.owner.pid < 1 || typeof j.owner.host !== "string" || typeof j.createdAt !== "string" || !/^[a-f0-9]{64}$/.test(j.indexBefore) || !/^[a-f0-9]{64}$/.test(j.indexAfter) || typeof j.indexContent !== "string" || hash(j.indexContent) !== j.indexAfter || !(j.cardBefore === null || /^[a-f0-9]{64}$/.test(j.cardBefore))) throw Error(); return j; } catch { throw new NovelError("library_recovery_invalid", "删卡恢复记录损坏，请保留并核对。"); }
}
async function classify(library: string, j: Intent) { const index = await snapshotFile(path.join(library, "index.json")); const card = await snapshotFile(path.join(library, "cards", `${j.cardId}.json`)); const writes = [{ file: "index.json", state: index === j.indexAfter ? "已写入" : index === j.indexBefore ? "待写入" : "冲突" }, { file: `cards/${j.cardId}.json`, state: card === null ? "已删除" : card === j.cardBefore ? "待删除" : "冲突" }]; return { writes, conflict: writes.some(w => w.state === "冲突") }; }
export async function createDiscardJournal(library: string, input: { cardId: string; indexBefore: string; indexContent: string; cardBefore: string | null }) {
    const j: Intent = { version: 1, id: randomUUID(), owner: { pid: process.pid, host: hostname() }, createdAt: new Date().toISOString(), ...input, indexAfter: hash(input.indexContent) };
    let h; try { h = await open(path.join(library, FILE), "wx", 0o600); } catch (err: any) { if (err?.code === "EEXIST") throw new NovelError("library_recovery_required", "已有待恢复的删卡操作，请先检查。"); throw err; }
    try { await h.writeFile(JSON.stringify(j, null, 2) + "\n"); await h.sync(); } catch (err) { await h.close(); await unlink(path.join(library, FILE)).catch(() => { }); throw err; } await h.close(); return j.id;
}
async function apply(library: string, j: Intent) {
    let state = await classify(library, j); if (state.conflict) throw new NovelError("library_recovery_conflict", `以下文件已变化，未覆盖：${state.writes.filter(w => w.state === "冲突").map(w => w.file).join("、")}。`);
    const indexPath = path.join(library, "index.json"), cardPath = path.join(library, "cards", `${j.cardId}.json`);
    if (state.writes[0].state === "待写入") { if (await snapshotFile(indexPath) !== j.indexBefore) throw new NovelError("library_recovery_conflict", "索引在恢复期间变化。"); await atomicWrite(indexPath, j.indexContent); }
    if (state.writes[1].state === "待删除") { if (await snapshotFile(cardPath) !== j.cardBefore) throw new NovelError("library_recovery_conflict", "卡片在恢复期间变化。"); await unlink(cardPath); }
    state = await classify(library, j); if (state.conflict || state.writes[0].state !== "已写入" || state.writes[1].state !== "已删除") throw new NovelError("library_recovery_conflict", "删卡文件在恢复期间变化，请保留记录并核对。");
    if ((await readIntent(library)).id !== j.id) throw new NovelError("library_recovery_conflict", "删卡恢复记录已变化。"); await unlink(path.join(library, FILE));
}
export async function finishDiscardJournal(library: string, id: string) { const j = await readIntent(library); if (j.id !== id) throw new NovelError("library_recovery_conflict", "删卡恢复记录已变化。"); await apply(library, j); }
export async function inspectPendingDiscard(library: string) { const j = await readIntent(library); return { id: j.id, cardId: j.cardId, createdAt: j.createdAt, ...await classify(library, j) }; }
export async function resumePendingDiscard(library: string) { return withResourceLock(library, async () => { const j = await readIntent(library); ensureRecoveryOwnerInactive(j.owner); await apply(library, j); return { cardId: j.cardId }; }); }
