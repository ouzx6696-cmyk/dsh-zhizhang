import type {
  AnyOp,
  AuditFinding,
  BibleIndex,
  BibleOp,
  BibleSnapshot,
  BibleView,
  CommitResult,
  Entity,
  PendingBatch,
  PendingItem,
  Provenance,
  RevertResult,
  StateEntry,
} from "@zhizhang/fanqie/bible";
import type { ImportBatchView, SectionKind } from "@zhizhang/fanqie/import";
import type { OutlineOp, OutlineView, RemapPreview } from "@zhizhang/fanqie/outline";

import type { ChapterRowView } from "@zhizhang/fanqie/view";
import type { Para, SegmentRules, TextEncoding } from "@zhizhang/core/text";

import type {
  BibleQueryItem,
  BibleEntityView,
  ChangeSetSummary,
  PendingBatchSummary,
  ImportProposalPage,
  PageInput,
} from "./commands.js";
export interface PlanCommandMap {
  "fanqie.outline.get": {
    input: { work: string };
    result: OutlineView;
    access: "read";
  };
  "fanqie.outline.apply": {
    input: { work: string; ops: OutlineOp[]; expectedRev: number };
    result: { changeId: string; rev: number };
    access: "write";
  };
  "fanqie.outline.remapPreview": {
    input: { work: string; ops: OutlineOp[] };
    result: RemapPreview;
    access: "read";
  };
  "fanqie.outline.remapCommit": {
    input: { work: string; token: string; ops: OutlineOp[] };
    result: { changeId: string; rev: number; remapped: number };
    access: "write";
  };
  "fanqie.chapter.createFromPlan": {
    input: { work: string; plan: string };
    result: { chapterId: string; row: ChapterRowView };
    access: "write";
  };
  "fanqie.bible.get": {
    input: { work: string };
    result: BibleSnapshot & { index: BibleIndex };
    access: "read";
  };
  "fanqie.bible.query": {
    input: {
      work: string;
      filter: {
        kind?: Entity["kind"];
        facet?: StateEntry["facet"];
        source?: Provenance["source"];
        status?: StateEntry["status"];
        conflict?: boolean;
        stale?: boolean;
        appearIn?: [number, number];
        q?: string;
      };
      position?: number;
      page: PageInput;
    };
    result: { items: BibleQueryItem[]; total: number };
    access: "read";
  };
  "fanqie.bible.entity": {
    input: { work: string; id: string; position?: number };
    result: BibleEntityView;
    access: "read";
  };
  "fanqie.bible.view": {
    input: { work: string; position: number };
    result: BibleView;
    access: "read";
  };
  "fanqie.bible.propose": {
    input: { work: string; ops: BibleOp[]; from: Provenance };
    result: { items: PendingItem[] };
    access: "write";
  };
  "fanqie.bible.apply": {
    input: { work: string; ops: BibleOp[]; expectedRev: number };
    result: { changeId: string };
    access: "write";
  };
  "fanqie.bible.changes": {
    input: { work: string; before?: string; limit?: number; source?: Provenance["source"] };
    result: { changes: ChangeSetSummary[] };
    access: "read";
  };
  "fanqie.bible.revert": {
    input: { work: string; changeId: string; force?: boolean };
    result: RevertResult;
    access: "write";
  };
  "fanqie.bible.audit": {
    input: { work: string; upTo: number };
    result: { findings: AuditFinding[] };
    access: "read";
  };
  "fanqie.pending.list": {
    input: { work: string; source?: PendingBatch["source"]; status?: PendingBatch["status"] };
    result: { batches: PendingBatchSummary[] };
    access: "read";
  };
  "fanqie.pending.get": {
    input: {
      work: string;
      batch: string;
      filter?: { change?: PendingItem["change"]; decision?: PendingItem["decision"] };
      page: PageInput;
    };
    result: { items: PendingItem[]; total: number; stats: Record<string, number> };
    access: "read";
  };
  "fanqie.pending.decide": {
    input: {
      work: string;
      batch: string;
      decisions: {
        id: string;
        decision: "accept" | "reject" | "edit";
        edited?: AnyOp;
        effectiveFrom?: number;
      }[];
    };
    result: { decided: number };
    access: "write";
  };
  "fanqie.pending.commit": {
    input: { work: string; batch: string; expectedRevs: BibleIndex["files"]; remapToken?: string };
    result: CommitResult;
    access: "write";
  };
  "fanqie.import.stage": {
    input: { work: string; token: string; rules?: SegmentRules };
    result: ImportBatchView;
    access: "write";
  };
  "fanqie.import.resegment": {
    input: { work: string; batch: string; rules: SegmentRules; encoding?: TextEncoding };
    result: ImportBatchView;
    access: "write";
  };
  "fanqie.import.select": {
    input: {
      work: string;
      batch: string;
      sections: { id: string; selected: boolean; kind?: SectionKind }[];
    };
    result: ImportBatchView;
    access: "write";
  };
  "fanqie.import.proposal": {
    input: {
      work: string;
      batch: string;
      filter?: { change?: PendingItem["change"]; decision?: PendingItem["decision"] };
      page: PageInput;
    };
    result: ImportProposalPage;
    access: "read";
  };
  "fanqie.import.source": {
    input: { work: string; batch: string; section: string; around?: string };
    result: { text: string; paras: Para[] };
    access: "read";
  };
  "fanqie.import.list": {
    input: { work: string };
    result: { batches: ImportBatchView[] };
    access: "read";
  };
  "fanqie.import.finish": {
    input: { work: string; batch: string };
    result: { status: string };
    access: "write";
  };
  "fanqie.import.revert": {
    input: { work: string; batch: string; force?: boolean };
    result: RevertResult;
    access: "write";
  };
  "fanqie.import.retryChunks": {
    input: { work: string; batch: string; chunks: number[] };
    result: { runId: string };
    access: "write";
  };
  "fanqie.check.run": {
    input: { work: string; upTo: number };
    result: AuditFinding[];
    access: "read";
  };
  "fanqie.reference.bind": {
    input: { work: string; sourceId: string; cardIds?: string[] };
    result: { work: string; sourceId: string; boundCount: number };
    access: "write";
  };
}
