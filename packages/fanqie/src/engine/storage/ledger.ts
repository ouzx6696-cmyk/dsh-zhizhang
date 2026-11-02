/** Business writes compose audit entries into their journal before persistence. */
import { readFile } from "node:fs/promises";
import { shortId } from "../../../../core/src/fsx.js";
import { SCHEMA_VERSION, type Ledger, type LedgerEntry } from "../types.js";
import { assertNoPendingAccept } from "./accept-journal.js";
import { readWorkMeta } from "./work-meta.js";
import { atomicWrite, isMissingFileError, nowIso } from "./primitives.js";
import { withResourceLock } from "./process-lock.js";
import { ledgerPath } from "./paths.js";
export async function readLedger(dir: string): Promise<Ledger> {
  await assertNoPendingAccept(dir);
  try {
    const data = JSON.parse(await readFile(ledgerPath(dir), "utf8"));
    if (!data || typeof data !== "object" || !Array.isArray(data.entries))
      throw new Error(`审校账本格式损坏：${ledgerPath(dir)}`);
    return data;
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    return { schemaVersion: SCHEMA_VERSION, workKey: (await readWorkMeta(dir)).key, entries: [] };
  }
}
const LEDGER_MAX_ENTRIES = 1000;
type EntryInput = Pick<LedgerEntry, "kind" | "summary"> & Partial<LedgerEntry>;
export function appendLedger(ledger: Ledger, entry: EntryInput): LedgerEntry {
  const full = { ...entry, id: entry.id ?? shortId("log", 8), at: entry.at ?? nowIso() };
  ledger.entries.push(full);
  ledger.entries = ledger.entries.slice(-LEDGER_MAX_ENTRIES);
  return full;
}
export async function writeLedgerEntry(dir: string, entry: EntryInput) {
  return withResourceLock(dir, async () => {
    const ledger = await readLedger(dir),
      full = appendLedger(ledger, entry);
    await atomicWrite(ledgerPath(dir), JSON.stringify(ledger, null, 2) + "\n");
    return full;
  });
}
