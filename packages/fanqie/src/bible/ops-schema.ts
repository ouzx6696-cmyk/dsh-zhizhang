/** 设定集操作、待确认批次与变更集的运行时解析器（F2 §3–§4）。 */
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import {
  arr,
  int,
  lit,
  num,
  obj,
  opt,
  record,
  str,
  union,
  type Parser,
} from "@zhizhang/core/schema";
import { OutlineOpSchema, SourceRefSchema } from "../outline/schema.js";
import {
  EvidenceSchema,
  EntitySchema,
  KnowledgeRowSchema,
  LedgerEntrySchema,
  StateEntrySchema,
  StyleRuleSchema,
  ThreadBeatSchema,
  ThreadSchema,
  TimelineEventSchema,
} from "./schema.js";
import type {
  AnyOp,
  BibleOp,
  ChangeSet,
  CommitResult,
  PendingBatch,
  PendingItem,
  RevertResult,
} from "./types.js";

const id = str({ min: 1, max: 200 });
const unknownValue: Parser<unknown> = (value) => value;

const BibleOpVariants = {
  "entity.upsert": obj({
    type: lit("entity.upsert"),
    entity: EntitySchema,
    expectedRev: opt(int({ min: 0 })),
  }),
  "entity.merge": obj({ type: lit("entity.merge"), keep: id, drop: id }),
  "entity.delete": obj({ type: lit("entity.delete"), id, expectedRev: int({ min: 0 }) }),
  "timeline.upsert": obj({
    type: lit("timeline.upsert"),
    event: TimelineEventSchema,
    expectedRev: opt(int({ min: 0 })),
  }),
  "state.add": obj({ type: lit("state.add"), entry: StateEntrySchema }),
  "state.update": obj({
    type: lit("state.update"),
    id,
    patch: obj({
      value: opt(str({ max: 2000 })),
      since: opt(int({ min: 1 })),
      until: opt(int({ min: 1 })),
      status: opt(lit("planned", "confirmed")),
      evidence: opt(EvidenceSchema),
    }),
    expectedRev: int({ min: 0 }),
  }),
  "state.delete": obj({ type: lit("state.delete"), id, expectedRev: int({ min: 0 }) }),
  "thread.upsert": obj({
    type: lit("thread.upsert"),
    thread: ThreadSchema,
    expectedRev: opt(int({ min: 0 })),
  }),
  "thread.beat": obj({
    type: lit("thread.beat"),
    thread: id,
    beat: ThreadBeatSchema,
    close: opt(lit("paid", "dropped")),
  }),
  "knowledge.set": obj({
    type: lit("knowledge.set"),
    row: KnowledgeRowSchema,
    expectedRev: opt(int({ min: 0 })),
  }),
  "ledger.write": obj({ type: lit("ledger.write"), entry: LedgerEntrySchema }),
  "style.update": obj({
    type: lit("style.update"),
    patch: obj({
      contract: opt(str({ max: 20000 })),
      rules: opt(arr(StyleRuleSchema, { max: 100 })),
      voiceSamples: opt(arr(str({ max: 4000 }), { max: 50 })),
    }),
  }),
} as const;

export const BibleOpSchema: Parser<BibleOp> = union("type", BibleOpVariants);

const OUTLINE_TAGS = new Set([
  "node.create",
  "node.update",
  "node.delete",
  "node.move",
  "chapter.split",
  "chapter.merge",
  "act.split",
  "volume.split",
  "act.merge",
  "volume.merge",
  "chapter.bind",
  "chapter.unbind",
  "book.update",
]);

export const AnyOpSchema: Parser<AnyOp> = (value, path = "$") => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    const tag = Reflect.get(value, "type");
    if (typeof tag === "string" && OUTLINE_TAGS.has(tag)) {
      return OutlineOpSchema(value, path);
    }
  }
  return BibleOpSchema(value, path);
};

export const PendingItemSchema: Parser<PendingItem> = obj({
  committed: opt(id),
  id,
  op: AnyOpSchema,
  change: lit("new", "update", "same", "conflict", "fulfill", "diverge"),
  diff: opt(
    arr(
      obj({
        field: str({ min: 1, max: 200 }),
        before: unknownValue,
        after: unknownValue,
      }),
    ),
  ),
  confidence: opt(
    obj({
      score: num({ min: 0, max: 1 }),
      band: lit("high", "mid", "low"),
      parts: record(num({ min: 0, max: 1 })),
    }),
  ),
  src: opt(arr(SourceRefSchema, { max: 20 })),
  evidence: opt(EvidenceSchema),
  group: str({ max: 200 }),
  dependsOn: arr(id, { max: 100 }),
  notes: arr(str({ max: 200 }), { max: 50 }),
  baseRev: opt(int({ min: 0 })),
  decision: lit("undecided", "accept", "reject", "edit"),
  edited: opt(AnyOpSchema),
  effectiveFrom: opt(int({ min: 0 })),
});

export const PendingBatchSchema: Parser<PendingBatch> = obj({
  format: lit(FORMAT_VERSION),
  id,
  source: lit("import", "ledger", "plan", "assistant"),
  run: opt(str({ max: 200 })),
  chapter: opt(int({ min: 1 })),
  reason: opt(str({ max: 200 })),
  created: str({ min: 1, max: 80 }),
  status: lit("open", "partial", "closed"),
  items: arr(PendingItemSchema),
  commits: arr(id, { max: 100 }),
});

const nullableText: Parser<string | null> = (value, path) =>
  value === null ? null : str()(value, path);

export const ChangeSetSchema: Parser<ChangeSet> = obj({
  snapshots: opt(arr(obj({ file: str({ max: 500 }), before: nullableText, after: nullableText }))),
  id,
  at: str({ min: 1, max: 80 }),
  kind: lit("apply", "revert"),
  reverts: opt(id),
  source: lit("author", "plan", "import", "ledger", "assistant"),
  batch: opt(str({ max: 80 })),
  run: opt(str({ max: 200 })),
  summary: str({ max: 200 }),
  ops: arr(AnyOpSchema),
  inverse: arr(AnyOpSchema),
  revs: record(int({ min: 0 })),
  files: arr(str({ max: 500 }), { max: 10000 }),
});

export const CommitResultSchema: Parser<CommitResult> = obj({
  changeId: id,
  committed: int({ min: 0 }),
  stale: arr(id),
});

export const RevertResultSchema: Parser<RevertResult> = obj({
  changeIds: arr(id),
  skipped: arr(obj({ target: str({ max: 500 }), reason: lit("rev_changed", "missing") })),
});
