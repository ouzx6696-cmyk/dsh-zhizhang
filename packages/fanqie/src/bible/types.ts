/**
 * 设定集与待确认批次的最终契约（arch-freeze-v1 / F2 §1–§4）。
 *
 * 本文件与 `outline/types.ts` 是冻结契约，只有 A-02 与 CCR 能改；
 * 运行时解析器见 `bible/schema.ts`。
 */
import type { OutlineOp, Provenance, ProvenanceSource, SourceRef } from "../outline/types.js";

export type { OutlineOp, Provenance, ProvenanceSource, SourceRef } from "../outline/types.js";

export type EntityKind = "character" | "faction" | "place" | "power" | "item" | "rule" | "term";

export interface Evidence {
  chapter: number;
  revision: string;
  quote: string;
  located: boolean;
}

export interface Entity {
  id: string;
  kind: EntityKind;
  name: string;
  aliases: string[];
  matchCase?: boolean;
  /** ≤4000 */
  summary: string;
  /** ≤40 键，值 ≤200 */
  attributes?: Record<string, string>;
  locked: string[];
  global?: boolean;
  parent?: string;
  related?: string[];
  introducedAt?: number;
  retiredAt?: number;
  provenance: Provenance;
  /** ≤10 */
  src?: SourceRef[];
  rev: number;
}

export interface TimelineEvent {
  id: string;
  title: string;
  when: string;
  order: number;
  era?: string;
  chapter?: number;
  entities: string[];
  summary: string;
  canon: "backstory" | "onstage";
  provenance: Provenance;
  src?: SourceRef[];
  rev: number;
}

export type Facet =
  "condition" | "location" | "relation" | "possession" | "ability" | "identity" | "other";

export interface StateEntry {
  id: string;
  entity: string;
  facet: Facet;
  field: string;
  target?: string;
  value: string;
  /** [since, until) */
  since: number;
  until?: number;
  mode: "replace" | "add";
  status: "planned" | "confirmed";
  evidence?: Evidence;
  provenance: Provenance;
  src?: SourceRef[];
  rev: number;
}

export interface ThreadBeat {
  chapter: number;
  kind: "plant" | "push" | "pay";
  note: string;
  evidence?: Evidence;
}

export interface Thread {
  id: string;
  title: string;
  kind: "foreshadow" | "mystery" | "promise" | "debt";
  opened: number;
  plannedPlant?: number;
  plannedPayoff?: number;
  dueBy?: number;
  importance: "major" | "minor";
  beats: ThreadBeat[];
  status: "open" | "paid" | "dropped";
  provenance: Provenance;
  src?: SourceRef[];
  rev: number;
}

export interface KnowledgeRow {
  id: string;
  fact: string;
  /** 实体 id */
  holder: string;
  level: "不知" | "怀疑" | "误认" | "知情" | "公开";
  since: number;
  evidence?: Evidence;
  provenance: Provenance;
  rev: number;
}

export interface Fact {
  id: string;
  /** ≤120 */
  text: string;
  entities: string[];
  kind: "event" | "reveal" | "change" | "promise";
  quote: string;
  located: boolean;
}

/** bible/ledger/<chapter-id>.json */
export interface LedgerEntry {
  format: "zhizhang/1.3";
  chapter: string;
  revision: string;
  position: number;
  /** ≤600 */
  summary: string;
  handoff: {
    ending: string;
    openQuestions: string[];
    positions: Record<string, string>;
    carried: string[];
  };
  hook: string;
  emotion: string;
  /** ≤60 */
  facts: Fact[];
  appearances: { entity: string; count: number }[];
  ledgerRun: string;
  rev: number;
}

export interface StyleContract {
  contract: string;
  rules: Array<{ id: string; condition: string; change: string; why: string }>;
  voiceSamples: string[];
}

/** bible/index.json */
export interface BibleIndex {
  format: "zhizhang/1.3";
  files: Record<
    "entities" | "timeline" | "states" | "threads" | "knowledge" | "style" | "outline",
    { rev: number; hash: string }
  >;
  lastLedgerChapter?: string;
}

/** 不落盘；store 读入后的只读快照。 */
export interface BibleSnapshot {
  entities: Entity[];
  timeline: TimelineEvent[];
  states: StateEntry[];
  threads: Thread[];
  knowledge: KnowledgeRow[];
  style: StyleContract;
}

export type PendingSource = "import" | "ledger" | "plan" | "assistant";
export type Decision = "undecided" | "accept" | "reject" | "edit";

export interface PendingItem {
  /** 首次提交的变更集回执，防止分批提交重复应用。 */
  committed?: string;
  /** p-… */
  id: string;
  op: AnyOp;
  change: "new" | "update" | "same" | "conflict" | "fulfill" | "diverge";
  diff?: { field: string; before: unknown; after: unknown }[];
  confidence?: { score: number; band: "high" | "mid" | "low"; parts: Record<string, number> };
  src?: SourceRef[];
  evidence?: Evidence;
  group: string;
  dependsOn: string[];
  /** 文案键 + 参数，不存中文长句。 */
  notes: string[];
  baseRev?: number;
  decision: Decision;
  edited?: AnyOp;
  effectiveFrom?: number;
}

export interface PendingBatch {
  format: "zhizhang/1.3";
  /** imp-… / led-… / pln-… / asst-… */
  id: string;
  source: PendingSource;
  run?: string;
  chapter?: number;
  reason?: string;
  created: string;
  status: "open" | "partial" | "closed";
  items: PendingItem[];
  commits: string[];
}

export interface ChangeSet {
  snapshots?: Array<{ file: string; before: string | null; after: string | null }>;
  id: string;
  at: string;
  kind: "apply" | "revert";
  reverts?: string;
  source: ProvenanceSource;
  batch?: string;
  run?: string;
  /** ≤200 */
  summary: string;
  ops: AnyOp[];
  inverse: AnyOp[];
  revs: Record<string, number>;
  files: string[];
}

export interface CommitResult {
  changeId: string;
  committed: number;
  stale: string[];
}

export interface RevertResult {
  changeIds: string[];
  skipped: { target: string; reason: "rev_changed" | "missing" }[];
}

export type BibleOp =
  | { type: "entity.upsert"; entity: Entity; expectedRev?: number }
  | { type: "entity.merge"; keep: string; drop: string }
  | { type: "entity.delete"; id: string; expectedRev: number }
  | { type: "timeline.upsert"; event: TimelineEvent; expectedRev?: number }
  | { type: "state.add"; entry: StateEntry }
  | {
      type: "state.update";
      id: string;
      patch: Partial<Pick<StateEntry, "value" | "since" | "until" | "status" | "evidence">>;
      expectedRev: number;
    }
  | { type: "state.delete"; id: string; expectedRev: number }
  | { type: "thread.upsert"; thread: Thread; expectedRev?: number }
  | { type: "thread.beat"; thread: string; beat: ThreadBeat; close?: "paid" | "dropped" }
  | { type: "knowledge.set"; row: KnowledgeRow; expectedRev?: number }
  | { type: "ledger.write"; entry: LedgerEntry }
  | { type: "style.update"; patch: Partial<StyleContract> };

export type AnyOp = BibleOp | OutlineOp;

/** asOf(N) 结果。 */
export interface BibleView {
  position: number;
  entities: Entity[];
  states: StateEntry[];
  threads: Thread[];
  knowledge: KnowledgeRow[];
  recentFacts: (Fact & { position: number })[];
}

export type AuditKind =
  | "thread_overdue"
  | "thread_forgotten"
  | "pay_unseen"
  | "pay_before_plant"
  | "cast_retired"
  | "location_jump"
  | "knowledge_leak"
  | "state_conflict"
  | "evidence_stale"
  | "word_target"
  | "plan_fact_divergence"
  | "dangling_ref";

export interface AuditFinding {
  kind: AuditKind;
  severity: "warn" | "bad";
  title: string;
  detail: string;
  refId: string;
  position?: number;
  jump: { view: "outline" | "entity" | "thread" | "chapter"; id: string };
}

export interface EntityHit {
  entity: Entity;
  count: number;
  firstIndex: number;
  matchedTerm: string;
}
