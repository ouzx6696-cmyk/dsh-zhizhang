import type {
  AnyOp,
  AuditFinding,
  BibleIndex,
  BibleOp,
  BibleSnapshot,
  BibleView,
  ChangeSet,
  CommitResult,
  Entity,
  PendingBatch,
  PendingItem,
  Provenance,
  RevertResult,
  StateEntry,
  Thread,
} from "@zhizhang/fanqie/bible";
import type { ImportBatchView, ImportProposal, SectionKind } from "@zhizhang/fanqie/import";
import type { OutlineOp, OutlineView, RemapPreview } from "@zhizhang/fanqie/outline";
import type { WorkMeta } from "@zhizhang/fanqie/storage";
import type { ChapterRowView, FanqieSnapshotDelta } from "@zhizhang/fanqie/view";
import type { Para, SegmentRules, TextEncoding } from "@zhizhang/core/text";
import type { commands as fanqieCommands } from "@zhizhang/fanqie";
import type { LedgerMutateResult, LedgerShowResult } from "@zhizhang/toutiao/rules";
import type { ArticleRowView } from "@zhizhang/toutiao/view";

export interface ProfileSummaryView {
  id: string;
  name: string;
  base?: string;
  note?: string;
  builtin: boolean;
}

export interface ProfileFileView {
  id: string;
  size: number;
  modified?: boolean;
}

export interface ProfileMethodView {
  id: string;
  text: string;
  from: "builtin" | "user";
}

export interface TechniqueCardView {
  id: string;
  title: string;
  category: string;
  pattern: string;
  example: string;
  usage: string;
}

export interface BibleQueryItem {
  entity: Entity;
  states: StateEntry[];
}

export interface BibleEntityView {
  entity: Entity;
  states: StateEntry[];
  relations: StateEntry[];
  threads: Thread[];
  appearances: number[];
}

export type ChangeSetSummary = Omit<ChangeSet, "ops" | "inverse">;

export type PendingBatchSummary = Omit<PendingBatch, "items"> & { items: number };

export interface ImportProposalPage {
  items: PendingItem[];
  stats: ImportProposal["stats"];
  total: number;
}

export interface PageInput {
  offset: number;
  limit: number;
}

export interface WorkbenchCommandMap {
  "fanqie.snapshot": {
    input: { work: string; since?: string };
    result: FanqieSnapshotDelta;
    access: "read";
  };
  "fanqie.chapter.list": {
    input: { work: string };
    result: { rows: ChapterRowView[] };
    access: "read";
  };
  "fanqie.chapter.get": {
    input: { work: string; chapter: string };
    result: { id: string; title: string; body: string; revision: string; status: string };
    access: "read";
  };
  "fanqie.chapter.save": {
    input: { work: string; chapter: string; base: string; body: string; title?: string };
    result: { revision: string; row: ChapterRowView };
    access: "write";
  };
  "fanqie.chapter.finalize": {
    input: { work: string; chapter: string };
    result: { status: "final" };
    access: "write";
  };
  "fanqie.candidate.list": {
    input: { work: string; chapter?: string };
    result: { candidates: Awaited<ReturnType<typeof fanqieCommands.listCandidates>> };
    access: "read";
  };
  "fanqie.candidate.get": {
    input: { work: string; chapter: string; candidateId: string };
    result: Awaited<ReturnType<typeof fanqieCommands.readCandidate>>;
    access: "read";
  };
  "fanqie.candidate.accept": {
    input: { work: string; chapter: string; candidateId: string; base: string };
    result: { revision: string };
    access: "write";
  };
  "fanqie.candidate.reject": {
    input: { work: string; chapter: string; candidateId: string; reason?: string };
    result: { candidateId: string; rejectedAt: string };
    access: "write";
  };
  "fanqie.work.list": {
    input: { root: string };
    result: { works: Awaited<ReturnType<typeof fanqieCommands.listWorks>> };
    access: "read";
  };
  "fanqie.work.get": {
    input: { work: string };
    result: WorkMeta;
    access: "read";
  };
  "fanqie.work.create": {
    input: {
      root: string;
      title: string;
      premise: string;
      grade: "economy" | "standard" | "premium";
    };
    result: { workPath: string };
    access: "write";
  };
  "fanqie.work.settings": {
    input: {
      work: string;
      grade?: "economy" | "standard" | "premium";
      profile?: string;
      requireEditorPass?: boolean;
      targetWords?: number;
      previousTextMode?: "auto" | "full" | "tail";
    };
    result: WorkMeta;
    access: "write";
  };
  "fanqie.book.export": {
    input: { work: string; format: "txt" | "docx"; finalOnly: boolean; outPath: string };
    result: { outPath: string; chapterCount: number };
    access: "read";
  };
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
    result: BibleSnapshot;
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
    input: { work: string; batch: string; expectedRevs: BibleIndex["files"] };
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
  "toutiao.articles": {
    input: { root: string };
    result: { rows: ArticleRowView[] };
    access: "read";
  };
  "toutiao.article.create": {
    input: { root: string; genre: string; driver: string };
    result: { articleDir: string };
    access: "write";
  };
  "toutiao.article.transition": {
    input: { articleDir: string; to: string };
    result: { status: string };
    access: "write";
  };
  "toutiao.article.deliver": {
    input: { articleDir: string; title: string; body: string };
    result: { deliveryPath: string };
    access: "write";
  };
  "toutiao.article.export": {
    input: {
      articleDir: string;
      outPath: string;
      format?: "md" | "txt";
      includeDelivery?: boolean;
    };
    result: { outPath: string; articleId: string; chars: number };
    access: "read";
  };
  "toutiao.draft.get": {
    input: { articleDir: string };
    /** 最新草稿；尚无草稿时 file 为空串。revision 与 toutiao.draft.save 的版本口径一致。 */
    result: { file: string; title: string; body: string; revision: string };
    access: "read";
  };
  "toutiao.draft.save": {
    input: { articleDir: string; title?: string; body: string; revision?: string };
    result: { draftPath: string; revision: string; chars: number };
    access: "write";
  };
  "toutiao.source.register": {
    input: {
      articleDir: string;
      sourceId: string;
      kind: "paste" | "file" | "classic";
      content: string;
    };
    result: { sourceId: string };
    access: "write";
  };
  "toutiao.ledger.show": {
    input: { ledgerPath: string; last?: number };
    result: LedgerShowResult;
    access: "read";
  };
  "toutiao.ledger.add": {
    input: {
      cardPath: string;
      ledgerPath: string;
      articleId?: string;
      status?: string;
      date?: string;
    };
    result: LedgerMutateResult;
    access: "write";
  };
  "toutiao.ledger.status": {
    input: { title: string; to: string; ledgerPath: string; articleId?: string };
    result: LedgerMutateResult;
    access: "write";
  };
  "toutiao.metrics.import": {
    input: { articleId: string; metricsJson: string; ledgerPath: string; url?: string };
    result: LedgerMutateResult;
    access: "write";
  };
  "profiles.list": {
    input: { mode: "fanqie" | "toutiao" };
    result: { mode: string; active: string; profiles: ProfileSummaryView[] };
    access: "read";
  };
  "profiles.detail": {
    input: { mode: "fanqie" | "toutiao"; profile?: string };
    result: { id: string; name: string; files: ProfileFileView[] };
    access: "read";
  };
  "profiles.method": {
    input: { mode: "fanqie" | "toutiao"; profile?: string; id: string };
    result: { method: ProfileMethodView; base_text?: string };
    access: "read";
  };
  "profiles.use": {
    input: { mode: "fanqie" | "toutiao"; profile: string };
    result: { profile: string };
    access: "write";
  };
  "profiles.create": {
    input: {
      mode: "fanqie" | "toutiao";
      name?: string;
      base?: string;
      note?: string;
      files?: Array<{ id: string; text: string }>;
    };
    result: { profile: string };
    access: "write";
  };
  "profiles.save": {
    input: { mode: "fanqie" | "toutiao"; profile: string; id: string; text: string };
    result: { saved: boolean };
    access: "write";
  };
  "profiles.reset": {
    input: { mode: "fanqie" | "toutiao"; profile: string; id: string };
    result: { reset: boolean };
    access: "write";
  };
  "profiles.rename": {
    input: { mode: "fanqie" | "toutiao"; profile: string; name: string; note?: string };
    result: { profile: string };
    access: "write";
  };
  "profiles.delete": {
    input: { mode: "fanqie" | "toutiao"; profile: string; confirm: boolean };
    result: { deleted: boolean };
    access: "write";
  };
  "library.import": {
    input: { libraryRoot: string; id: string; title: string; content: string };
    result: Awaited<ReturnType<typeof fanqieCommands.importLibrarySource>>;
    access: "write";
  };
  "library.list": {
    input: { libraryRoot: string };
    result: { sources: Awaited<ReturnType<typeof fanqieCommands.listLibrarySources>> };
    access: "read";
  };
  "library.cards": {
    input: { libraryRoot: string; sourceId: string };
    result: { cards: TechniqueCardView[]; report?: string };
    access: "read";
  };
  "library.dissect": {
    input: { libraryRoot: string; sourceId: string; title: string; sourcePath?: string };
    result: { sourceId: string; title: string; cardCount: number; summary: string };
    access: "write";
  };
}

export type WorkbenchCommand = keyof WorkbenchCommandMap;
export type CommandInput<K extends WorkbenchCommand> = WorkbenchCommandMap[K]["input"];
export type CommandResult<K extends WorkbenchCommand> = WorkbenchCommandMap[K]["result"];

export type CommandRefreshScope =
  | "rows"
  | "chapter"
  | "bible"
  | "article"
  | "profiles"
  | "library"
  | "outline"
  | "imports"
  | "pending";

export interface CommandPolicy<K extends WorkbenchCommand> {
  access: WorkbenchCommandMap[K]["access"];
  /** 写命令成功后广播给渲染层的刷新范围；多范围按顺序各发一条。 */
  refresh?: CommandRefreshScope | CommandRefreshScope[];
}

/** 读写与广播策略的唯一来源：主进程据此做只读门禁与 workspace.changed 广播。 */
export const COMMAND_POLICY: { readonly [K in WorkbenchCommand]: CommandPolicy<K> } = {
  "fanqie.snapshot": { access: "read" },
  "fanqie.chapter.list": { access: "read" },
  "fanqie.chapter.get": { access: "read" },
  "fanqie.chapter.save": { access: "write", refresh: "chapter" },
  "fanqie.chapter.finalize": { access: "write", refresh: "chapter" },
  "fanqie.candidate.list": { access: "read" },
  "fanqie.candidate.get": { access: "read" },
  "fanqie.candidate.accept": { access: "write", refresh: "chapter" },
  "fanqie.candidate.reject": { access: "write", refresh: "chapter" },
  "fanqie.work.list": { access: "read" },
  "fanqie.work.get": { access: "read" },
  "fanqie.work.create": { access: "write", refresh: "rows" },
  "fanqie.work.settings": { access: "write", refresh: "rows" },
  "fanqie.book.export": { access: "read" },
  "fanqie.outline.get": { access: "read" },
  "fanqie.outline.apply": { access: "write", refresh: "outline" },
  "fanqie.outline.remapPreview": { access: "read" },
  "fanqie.outline.remapCommit": {
    access: "write",
    refresh: ["outline", "bible", "rows"],
  },
  "fanqie.chapter.createFromPlan": { access: "write", refresh: ["rows", "outline"] },
  "fanqie.bible.get": { access: "read" },
  "fanqie.bible.query": { access: "read" },
  "fanqie.bible.entity": { access: "read" },
  "fanqie.bible.view": { access: "read" },
  "fanqie.bible.propose": { access: "write", refresh: "pending" },
  "fanqie.bible.apply": { access: "write", refresh: "bible" },
  "fanqie.bible.changes": { access: "read" },
  "fanqie.bible.revert": { access: "write", refresh: ["bible", "outline"] },
  "fanqie.bible.audit": { access: "read" },
  "fanqie.pending.list": { access: "read" },
  "fanqie.pending.get": { access: "read" },
  "fanqie.pending.decide": { access: "write", refresh: "pending" },
  "fanqie.pending.commit": {
    access: "write",
    refresh: ["bible", "outline", "pending"],
  },
  "fanqie.import.stage": { access: "write", refresh: "imports" },
  "fanqie.import.resegment": { access: "write", refresh: "imports" },
  "fanqie.import.select": { access: "write", refresh: "imports" },
  "fanqie.import.proposal": { access: "read" },
  "fanqie.import.source": { access: "read" },
  "fanqie.import.list": { access: "read" },
  "fanqie.import.finish": { access: "write", refresh: "imports" },
  "fanqie.import.revert": { access: "write", refresh: ["bible", "outline", "imports"] },
  "fanqie.import.retryChunks": { access: "write", refresh: "imports" },
  "fanqie.check.run": { access: "read" },
  "fanqie.reference.bind": { access: "write", refresh: "rows" },
  "toutiao.articles": { access: "read" },
  "toutiao.article.create": { access: "write", refresh: "article" },
  "toutiao.article.transition": { access: "write", refresh: "article" },
  "toutiao.article.deliver": { access: "write", refresh: "article" },
  "toutiao.article.export": { access: "read" },
  "toutiao.draft.get": { access: "read" },
  "toutiao.draft.save": { access: "write", refresh: "article" },
  "toutiao.source.register": { access: "write", refresh: "article" },
  "toutiao.ledger.show": { access: "read" },
  "toutiao.ledger.add": { access: "write", refresh: "article" },
  "toutiao.ledger.status": { access: "write", refresh: "article" },
  "toutiao.metrics.import": { access: "write", refresh: "article" },
  "profiles.list": { access: "read" },
  "profiles.detail": { access: "read" },
  "profiles.method": { access: "read" },
  "profiles.use": { access: "write", refresh: "profiles" },
  "profiles.create": { access: "write", refresh: "profiles" },
  "profiles.save": { access: "write", refresh: "profiles" },
  "profiles.reset": { access: "write", refresh: "profiles" },
  "profiles.rename": { access: "write", refresh: "profiles" },
  "profiles.delete": { access: "write", refresh: "profiles" },
  "library.import": { access: "write", refresh: "library" },
  "library.list": { access: "read" },
  "library.cards": { access: "read" },
  "library.dissect": { access: "write", refresh: "library" },
};
