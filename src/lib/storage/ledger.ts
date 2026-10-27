/** Shared audit persistence; business writes compose this data into their journal. */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { SCHEMA_VERSION } from "../types.js";
import { assertNoPendingAccept } from "./accept-journal.js";
import { readWorkMeta } from "./work-meta.js";
import { atomicWrite, isMissingFileError, nowIso } from "./primitives.js";
import { withResourceLock } from "./process-lock.js";
const ledgerPath = (dir: string) => path.join(dir, "ledger.json");
export async function readLedger(dir: string) {
    await assertNoPendingAccept(dir);
    try {
        const raw = await readFile(ledgerPath(dir), "utf8");
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object" || !Array.isArray(data.entries))
            throw new Error(`审校账本格式损坏：${ledgerPath(dir)}`);
        return data;
    }
    catch (err) {
        if (!isMissingFileError(err))
            throw err;
        const meta = await readWorkMeta(dir);
        return { schemaVersion: SCHEMA_VERSION, workKey: meta.key, entries: [] };
    }
}
/** ledger.json 保留的最大条数：面板/回溯只用最近若干条，超出即裁掉最旧的，防止整文件随章节数无限膨胀。 */
export const LEDGER_MAX_ENTRIES = 1000;
export async function appendLedger(dir: string, entry: any) {
    return withResourceLock(dir, async () => {
        const ledger = await readLedger(dir);
        const full = {
            id: entry.id ?? randomUUID().slice(0, 8),
            at: entry.at ?? nowIso(),
            chapterId: entry.chapterId,
            kind: entry.kind,
            summary: entry.summary,
            dims: entry.dims,
            issues: entry.issues,
            styleHitCount: entry.styleHitCount,
        };
        ledger.entries.push(full);
        if (ledger.entries.length > LEDGER_MAX_ENTRIES)
            ledger.entries = ledger.entries.slice(-LEDGER_MAX_ENTRIES);
        await atomicWrite(ledgerPath(dir), JSON.stringify(ledger, null, 2) + "\n");
        return full;
    });
}
