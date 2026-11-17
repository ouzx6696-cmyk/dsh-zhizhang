/** 设定集门面：读取、asOf、匹配、巡检、批次、变更集与撤销。 */
import { systemClock, type Clock } from "@zhizhang/core/clock";
import { createIdSource, type IdSource } from "@zhizhang/core/id";
import type { LockService } from "@zhizhang/core/lock";
import { asOf as viewAt } from "./asof.js";
import { auditBible } from "./audit.js";
import { commitApply, commitBatch, listChanges, revertChange } from "./commit.js";
import { matchEntities } from "./match.js";
import { proposeBatch, decideBatch, type PendingDecision, type ProposeOpMeta } from "./pending.js";
import { entityView, queryBible, type BibleFilter, type PageInput } from "./query.js";
import {
  lastLedger,
  readLedgers,
  pendingCount,
  readBible,
  readLib,
  readPendingBatch,
  readPendingBatches,
} from "./read.js";
import type {
  BibleOp,
  BibleSnapshot,
  BibleView,
  ChangeSet,
  CommitResult,
  LedgerEntry,
  PendingBatch,
  PendingItem,
  Provenance,
  RevertResult,
  BibleIndex,
} from "./types.js";

export type { ProposeOpMeta } from "./pending.js";

export interface BibleStoreOptions {
  ids?: IdSource;
  clock?: Clock;
}

export function createBibleStore(lock: LockService, options: BibleStoreOptions = {}) {
  const ids = options.ids ?? createIdSource();
  const clock = options.clock ?? systemClock;
  const deps = { lock, ids, clock };

  return {
    read(workPath: string): Promise<BibleSnapshot> {
      return readBible(workPath);
    },
    ledgers(workPath: string): Promise<LedgerEntry[]> {
      return readLedgers(workPath);
    },
    lastLedger(workPath: string): Promise<LedgerEntry | undefined> {
      return lastLedger(workPath);
    },
    readPendingBatches(workPath: string): Promise<PendingBatch[]> {
      return readPendingBatches(workPath);
    },
    readPendingBatch(workPath: string, batch: string): Promise<PendingBatch | undefined> {
      return readPendingBatch(workPath, batch);
    },
    pendingCount(workPath: string): Promise<number> {
      return pendingCount(workPath);
    },
    asOf(
      bible: BibleSnapshot,
      position: number,
      ledgerList: LedgerEntry[] = [],
      recentFactsWindow = 5,
    ): BibleView {
      return viewAt(bible, position, ledgerList, recentFactsWindow);
    },
    match(view: BibleView, texts: string[]) {
      return matchEntities(view, texts);
    },
    audit(bible: BibleSnapshot, upTo: number, ledgerList: LedgerEntry[] = []) {
      return auditBible(bible, upTo, ledgerList);
    },
    propose(
      workPath: string,
      ops: BibleOp[],
      from: Provenance,
      metaList?: ProposeOpMeta[],
    ): Promise<PendingItem[]> {
      return proposeBatch(
        workPath,
        ops,
        {
          source: from.source,
          ...(from.run ? { run: from.run } : {}),
          ...(from.chapter ? { chapter: from.chapter } : {}),
          at: from.at,
        },
        metaList,
        deps,
      );
    },
    decide(
      workPath: string,
      batch: string,
      decisions: PendingDecision[],
    ): Promise<{ decided: number }> {
      return decideBatch(workPath, batch, decisions, lock);
    },
    apply(workPath: string, ops: BibleOp[], expectedRev: number): Promise<{ changeId: string }> {
      return commitApply(
        workPath,
        ops,
        expectedRev,
        { source: "author", summary: `手动应用 ${ops.length} 项设定集改动` },
        deps,
      );
    },
    commit(
      workPath: string,
      batch: string,
      expectedRevs: BibleIndex["files"],
    ): Promise<CommitResult> {
      return commitBatch(workPath, batch, expectedRevs, deps);
    },
    revert(workPath: string, changeId: string, force = false): Promise<RevertResult> {
      return revertChange(workPath, changeId, force, deps);
    },
    changes(
      workPath: string,
      before: string | undefined,
      limit: number,
      source?: ChangeSet["source"],
    ) {
      return listChanges(workPath, before, limit, source);
    },
    async query(
      workPath: string,
      filter: BibleFilter,
      position: number | undefined,
      page: PageInput,
    ) {
      const lib = await readLib(workPath);
      return queryBible(lib, filter, position, page);
    },
    async entity(workPath: string, id: string, position?: number) {
      const lib = await readLib(workPath);
      return entityView(lib, id, position);
    },
  };
}

export type BibleStore = ReturnType<typeof createBibleStore>;
