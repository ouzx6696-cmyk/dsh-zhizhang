/** 设定集、待确认批次与变更集的运行时解析器（F2 §3–§4）。 */
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { arr, bool, int, lit, obj, opt, record, str, type Parser } from "@zhizhang/core/schema";
import { ProvenanceSchema, SourceRefSchema } from "../outline/schema.js";
import type {
  AuditFinding,
  BibleIndex,
  BibleSnapshot,
  BibleView,
  Entity,
  Fact,
  KnowledgeRow,
  LedgerEntry,
  StateEntry,
  StyleContract,
  Thread,
  ThreadBeat,
  TimelineEvent,
} from "./types.js";

const id = str({ min: 1, max: 200 });

export const EntityKindSchema = lit(
  "character",
  "faction",
  "place",
  "power",
  "item",
  "rule",
  "term",
);

export const FacetSchema = lit(
  "condition",
  "location",
  "relation",
  "possession",
  "ability",
  "identity",
  "other",
);

export const EvidenceSchema = obj({
  chapter: int({ min: 1 }),
  revision: str({ min: 1, max: 200 }),
  quote: str({ max: 500 }),
  located: bool,
});

export const EntitySchema: Parser<Entity> = obj({
  id,
  kind: EntityKindSchema,
  name: str({ min: 1, max: 200 }),
  aliases: arr(str({ max: 200 }), { max: 50 }),
  matchCase: opt(bool),
  summary: str({ max: 4000 }),
  attributes: opt(record(str({ max: 200 }))),
  locked: arr(str({ max: 200 }), { max: 100 }),
  global: opt(bool),
  parent: opt(id),
  related: opt(arr(id, { max: 100 })),
  introducedAt: opt(int({ min: 1 })),
  retiredAt: opt(int({ min: 1 })),
  provenance: ProvenanceSchema,
  src: opt(arr(SourceRefSchema, { max: 10 })),
  rev: int({ min: 0 }),
});

export const TimelineEventSchema: Parser<TimelineEvent> = obj({
  id,
  title: str({ min: 1, max: 200 }),
  when: str({ min: 1, max: 120 }),
  order: int(),
  era: opt(str({ max: 120 })),
  chapter: opt(int({ min: 1 })),
  entities: arr(id, { max: 100 }),
  summary: str({ max: 4000 }),
  canon: lit("backstory", "onstage"),
  provenance: ProvenanceSchema,
  src: opt(arr(SourceRefSchema, { max: 10 })),
  rev: int({ min: 0 }),
});

export const StateEntrySchema: Parser<StateEntry> = obj({
  id,
  entity: id,
  facet: FacetSchema,
  field: str({ min: 1, max: 120 }),
  target: opt(id),
  value: str({ max: 2000 }),
  since: int({ min: 1 }),
  until: opt(int({ min: 1 })),
  mode: lit("replace", "add"),
  status: lit("planned", "confirmed"),
  evidence: opt(EvidenceSchema),
  provenance: ProvenanceSchema,
  src: opt(arr(SourceRefSchema, { max: 10 })),
  rev: int({ min: 0 }),
});

export const ThreadBeatSchema: Parser<ThreadBeat> = obj({
  chapter: int({ min: 1 }),
  kind: lit("plant", "push", "pay"),
  note: str({ max: 2000 }),
  evidence: opt(EvidenceSchema),
});

export const ThreadSchema: Parser<Thread> = obj({
  id,
  title: str({ min: 1, max: 200 }),
  kind: lit("foreshadow", "mystery", "promise", "debt"),
  opened: int({ min: 1 }),
  plannedPlant: opt(int({ min: 1 })),
  plannedPayoff: opt(int({ min: 1 })),
  dueBy: opt(int({ min: 1 })),
  importance: lit("major", "minor"),
  beats: arr(ThreadBeatSchema, { max: 200 }),
  status: lit("open", "paid", "dropped"),
  provenance: ProvenanceSchema,
  src: opt(arr(SourceRefSchema, { max: 10 })),
  rev: int({ min: 0 }),
});

export const KnowledgeRowSchema: Parser<KnowledgeRow> = obj({
  id,
  fact: str({ min: 1, max: 500 }),
  holder: id,
  level: lit("不知", "怀疑", "误认", "知情", "公开"),
  since: int({ min: 1 }),
  evidence: opt(EvidenceSchema),
  provenance: ProvenanceSchema,
  rev: int({ min: 0 }),
});

export const FactSchema: Parser<Fact> = obj({
  id,
  text: str({ max: 120 }),
  entities: arr(id, { max: 100 }),
  kind: lit("event", "reveal", "change", "promise"),
  quote: str({ max: 500 }),
  located: bool,
});

export const LedgerEntrySchema: Parser<LedgerEntry> = obj({
  format: lit(FORMAT_VERSION),
  chapter: id,
  revision: str({ min: 1, max: 200 }),
  position: int({ min: 1 }),
  summary: str({ max: 600 }),
  handoff: obj({
    ending: str({ max: 2000 }),
    openQuestions: arr(str({ max: 500 }), { max: 50 }),
    positions: record(str({ max: 500 })),
    carried: arr(str({ max: 500 }), { max: 100 }),
  }),
  hook: str({ max: 500 }),
  emotion: str({ max: 120 }),
  facts: arr(FactSchema, { max: 60 }),
  appearances: arr(obj({ entity: id, count: int({ min: 0 }) }), { max: 200 }),
  ledgerRun: str({ min: 1, max: 200 }),
  rev: int({ min: 0 }),
});

export const StyleRuleSchema = obj({
  id,
  condition: str({ max: 500 }),
  change: str({ max: 500 }),
  why: str({ max: 1000 }),
});

export const StyleContractSchema: Parser<StyleContract> = obj({
  contract: str({ max: 20000 }),
  rules: arr(StyleRuleSchema, { max: 100 }),
  voiceSamples: arr(str({ max: 4000 }), { max: 50 }),
});

const IndexFileSchema = obj({ rev: int({ min: 0 }), hash: str({ max: 200 }) });

export const BibleIndexFilesSchema = obj({
  entities: IndexFileSchema,
  timeline: IndexFileSchema,
  states: IndexFileSchema,
  threads: IndexFileSchema,
  knowledge: IndexFileSchema,
  style: IndexFileSchema,
  outline: IndexFileSchema,
});

export const BibleIndexSchema: Parser<BibleIndex> = obj({
  format: lit(FORMAT_VERSION),
  files: BibleIndexFilesSchema,
  lastLedgerChapter: opt(id),
});

export const BibleSnapshotSchema: Parser<BibleSnapshot> = obj({
  entities: arr(EntitySchema),
  timeline: arr(TimelineEventSchema),
  states: arr(StateEntrySchema),
  threads: arr(ThreadSchema),
  knowledge: arr(KnowledgeRowSchema),
  style: StyleContractSchema,
});

export const BibleViewSchema: Parser<BibleView> = obj({
  position: int({ min: 1 }),
  entities: arr(EntitySchema),
  states: arr(StateEntrySchema),
  threads: arr(ThreadSchema),
  knowledge: arr(KnowledgeRowSchema),
  recentFacts: arr(
    obj({
      id,
      text: str({ max: 120 }),
      entities: arr(id, { max: 100 }),
      kind: lit("event", "reveal", "change", "promise"),
      quote: str({ max: 500 }),
      located: bool,
      position: int({ min: 1 }),
    }),
  ),
});

export const AuditKindSchema = lit(
  "thread_overdue",
  "thread_forgotten",
  "pay_unseen",
  "pay_before_plant",
  "cast_retired",
  "location_jump",
  "knowledge_leak",
  "state_conflict",
  "evidence_stale",
  "word_target",
  "plan_fact_divergence",
  "dangling_ref",
);

export const AuditFindingSchema: Parser<AuditFinding> = obj({
  kind: AuditKindSchema,
  severity: lit("warn", "bad"),
  title: str({ min: 1, max: 200 }),
  detail: str({ max: 2000 }),
  refId: id,
  position: opt(int({ min: 1 })),
  jump: obj({ view: lit("outline", "entity", "thread", "chapter"), id }),
});
