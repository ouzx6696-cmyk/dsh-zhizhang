import path from "node:path";
import { readFile } from "node:fs/promises";
import { SCHEMA_VERSION } from "../types.js";
import { NovelError } from "../errors.js";
import type { ContextBasis } from "../domain/lifecycle.js";
import { BRIEF_RECENT_MS } from "../domain/constants.js";
import { assertNoPendingAccept } from "./accept-journal.js";
import { createWorkRecordJournal, finishChapterJournal } from "./chapter-journal.js";
import { assertContextBasis } from "./chapters.js";
import { snapshotFile } from "./journal.js";
import { nowIso, isMissingFileError } from "./primitives.js";
import { readWorkMeta } from "./work-meta.js";
import { appendLedger, readLedger } from "./ledger.js";
import { ledgerPath } from "./paths.js";
import { withResourceLock } from "./process-lock.js";

type RecordEntry = { chapterId: string; at: string; basis?: ContextBasis };
interface BriefRecord extends RecordEntry {
  assetIds: string[];
}
interface PayoffRecord extends RecordEntry {
  summary: string;
  bodyHash?: string;
  outlineHash?: string;
  source?: string;
  sourceId?: string;
  ok: boolean;
  warningCount: number;
  codes: string[];
}
function workRecords<T extends RecordEntry>(
  kind: "brief" | "payoff",
  limit: number,
  summary: (entry: T) => string,
) {
  const filename = kind === "brief" ? "brief-crumbs.json" : "payoff-audits.json";
  const label = kind === "brief" ? "简报" : "兑付";
  async function read(
    dir: string,
  ): Promise<{ schemaVersion: number; workKey: string; entries: T[] }> {
    await assertNoPendingAccept(dir);
    try {
      const data = JSON.parse(await readFile(path.join(dir, filename), "utf8"));
      if (!data || typeof data !== "object" || !Array.isArray(data.entries))
        throw new NovelError(
          `bad_${kind}_records`,
          `${label}留痕格式损坏：${path.join(dir, filename)}`,
        );
      return data;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      return { schemaVersion: SCHEMA_VERSION, workKey: (await readWorkMeta(dir)).key, entries: [] };
    }
  }
  async function append(dir: string, input: Omit<T, "at"> & { at?: string }) {
    return withResourceLock(dir, async () => {
      const [recordBefore, ledgerBefore] = await Promise.all([
        snapshotFile(path.join(dir, filename)),
        snapshotFile(ledgerPath(dir)),
      ]);
      const file = await read(dir),
        ledger = await readLedger(dir);
      if (kind === "brief" && input.basis)
        await assertContextBasis(dir, input.basis, input.chapterId);
      const entry = { ...input, at: input.at ?? nowIso() } as T;
      file.entries.push(entry);
      file.entries = file.entries.slice(-limit);
      appendLedger(ledger, {
        chapterId: entry.chapterId,
        kind: kind === "brief" ? "brief_seen" : "payoff_audit",
        summary: summary(entry),
      });
      if (
        (await snapshotFile(path.join(dir, filename))) !== recordBefore ||
        (await snapshotFile(ledgerPath(dir))) !== ledgerBefore
      )
        throw new NovelError("recovery_conflict", "留痕文件在准备期间变化，请重新检查。");
      const journal = await createWorkRecordJournal(dir, {
        kind,
        chapterId: entry.chapterId,
        writes: [
          { file: filename, before: recordBefore, content: JSON.stringify(file, null, 2) + "\n" },
          {
            file: "ledger.json",
            before: ledgerBefore,
            content: JSON.stringify(ledger, null, 2) + "\n",
          },
        ],
      });
      await finishChapterJournal(dir, journal);
      return entry;
    });
  }
  async function recent(dir: string, chapterId: string, maxAgeMs = BRIEF_RECENT_MS) {
    const { entries } = await read(dir),
      now = Date.now();
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i],
        at = Date.parse(entry.at);
      if (entry.chapterId !== chapterId || !Number.isFinite(at)) continue;
      return entry.basis || now - at <= maxAgeMs ? entry : null;
    }
    return null;
  }
  return { read, append, recent };
}
const brief = workRecords<BriefRecord>(
  "brief",
  200,
  (entry) => `chapter_brief · assets=${entry.assetIds.join(",") || "(none)"}`,
);
const payoff = workRecords<PayoffRecord>("payoff", 100, (entry) => entry.summary);
export const readBriefCrumbs = brief.read,
  recordBriefBreadcrumb = brief.append,
  getRecentBrief = brief.recent;
export const readPayoffAudits = payoff.read,
  storePayoffAudit = payoff.append,
  getRecentPayoffAudit = payoff.recent;
