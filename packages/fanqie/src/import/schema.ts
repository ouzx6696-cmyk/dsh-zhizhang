/** 导入契约的运行时解析器（F2 §5.2）。 */
import { FORMAT_VERSION } from "@zhizhang/core/version";
import {
  arr,
  bool,
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
import { TextEncodingSchema } from "@zhizhang/core/text/schema";
import { PendingItemSchema } from "../bible/ops-schema.js";
import { BibleIndexFilesSchema, EntityKindSchema, FacetSchema } from "../bible/schema.js";
import { BeatSchema } from "../outline/schema.js";
import type {
  DocMap,
  ExtractItem,
  ExtractResult,
  ImportBatchView,
  ImportEstimate,
  ImportFailReason,
  ImportProposal,
  ImportSourceMeta,
} from "./types.js";

const id = str({ min: 1, max: 200 });

export const SectionKindSchema = lit(
  "outline-volume",
  "outline-act",
  "outline-chapter",
  "setting-character",
  "setting-faction",
  "setting-place",
  "setting-power",
  "setting-item",
  "setting-rule",
  "setting-term",
  "timeline",
  "mixed",
  "ignore",
  "unknown",
);

export const DocMapSchema: Parser<DocMap> = obj({
  mapping: obj({
    volume: opt(str({ max: 200 })),
    act: opt(str({ max: 200 })),
    chapter: opt(str({ max: 200 })),
  }),
  sections: arr(obj({ id, kind: SectionKindSchema, note: opt(str({ max: 500 })) })),
  naming: arr(str({ max: 80 }), { max: 10 }),
  editedByAuthor: bool,
});

const ItemBaseFields = {
  tmp: id,
  src: arr(str({ min: 1, max: 40 }), { max: 20 }),
  quote: str({ max: 80 }),
  confidence: num({ min: 0, max: 1 }),
  ref: opt(id),
  maybe: opt(arr(id, { max: 50 })),
  why: opt(str({ max: 1000 })),
} as const;

export const ExtractItemSchema: Parser<ExtractItem> = union("type", {
  volume: obj({
    ...ItemBaseFields,
    type: lit("volume"),
    title: str({ min: 1, max: 60 }),
    order: opt(int({ min: 0 })),
    summary: opt(str({ max: 2000 })),
    goal: opt(str({ max: 500 })),
    conflict: opt(str({ max: 500 })),
    payoffs: opt(arr(str({ max: 120 }), { max: 10 })),
    hook: opt(str({ max: 300 })),
    wordTarget: opt(int({ min: 500, max: 2_000_000 })),
  }),
  act: obj({
    ...ItemBaseFields,
    type: lit("act"),
    parent: id,
    title: str({ min: 1, max: 60 }),
    order: opt(int({ min: 0 })),
    summary: opt(str({ max: 2000 })),
    goal: opt(str({ max: 500 })),
    conflict: opt(str({ max: 500 })),
    payoffs: opt(arr(str({ max: 120 }), { max: 10 })),
    hook: opt(str({ max: 300 })),
    wordTarget: opt(int({ min: 500, max: 2_000_000 })),
  }),
  chapter: obj({
    ...ItemBaseFields,
    type: lit("chapter"),
    parent: id,
    title: str({ min: 1, max: 60 }),
    order: opt(int({ min: 0 })),
    summary: opt(str({ max: 2000 })),
    goal: opt(str({ max: 500 })),
    conflict: opt(str({ max: 500 })),
    payoffs: opt(arr(str({ max: 120 }), { max: 10 })),
    hook: opt(str({ max: 300 })),
    wordTarget: opt(int({ min: 500, max: 2_000_000 })),
    cast: opt(arr(id, { max: 40 })),
    pov: opt(id),
    location: opt(id),
    plant: opt(arr(id, { max: 20 })),
    pay: opt(arr(id, { max: 20 })),
    beats: opt(arr(BeatSchema, { max: 20 })),
    mustInclude: opt(arr(str({ max: 120 }), { max: 10 })),
    mustAvoid: opt(arr(str({ max: 120 }), { max: 10 })),
    timeAnchor: opt(str({ max: 60 })),
  }),
  entity: obj({
    ...ItemBaseFields,
    type: lit("entity"),
    kind: EntityKindSchema,
    name: str({ min: 1, max: 200 }),
    aliases: opt(arr(str({ max: 200 }), { max: 50 })),
    summary: opt(str({ max: 4000 })),
    attributes: opt(record(str({ max: 200 }))),
    locked: opt(arr(str({ max: 200 }), { max: 100 })),
    parent: opt(id),
    relations: opt(arr(obj({ to: id, label: str({ max: 120 }) }), { max: 100 })),
  }),
  state: obj({
    ...ItemBaseFields,
    type: lit("state"),
    entity: id,
    facet: FacetSchema,
    field: opt(str({ max: 120 })),
    target: opt(id),
    value: str({ max: 2000 }),
    since: opt(int({ min: 1 })),
    until: opt(int({ min: 1 })),
  }),
  thread: obj({
    ...ItemBaseFields,
    type: lit("thread"),
    title: str({ min: 1, max: 200 }),
    kind: lit("foreshadow", "mystery", "promise", "debt"),
    plantAt: opt(int({ min: 1 })),
    payAt: opt(int({ min: 1 })),
    importance: opt(lit("major", "minor")),
    note: opt(str({ max: 2000 })),
  }),
  timeline: obj({
    ...ItemBaseFields,
    type: lit("timeline"),
    title: str({ min: 1, max: 200 }),
    when: str({ min: 1, max: 120 }),
    order: opt(int()),
    chapter: opt(int({ min: 1 })),
    entities: opt(arr(id, { max: 100 })),
    summary: opt(str({ max: 4000 })),
    canon: opt(lit("backstory", "onstage")),
  }),
  knowledge: obj({
    ...ItemBaseFields,
    type: lit("knowledge"),
    holder: id,
    fact: str({ min: 1, max: 500 }),
    level: lit("不知", "怀疑", "误认", "知情", "公开"),
    since: opt(int({ min: 1 })),
  }),
  note: obj({ ...ItemBaseFields, type: lit("note"), text: str({ min: 1, max: 4000 }) }),
});

export const ExtractResultSchema: Parser<ExtractResult> = obj({
  items: arr(ExtractItemSchema, { max: 80 }),
  unassigned: arr(obj({ src: arr(str({ max: 40 }), { max: 20 }), reason: str({ max: 500 }) })),
});

export const ImportSourceMetaSchema: Parser<ImportSourceMeta> = obj({
  name: str({ min: 1, max: 500 }),
  bytes: int({ min: 0 }),
  sha256: str({ min: 1, max: 200 }),
  encoding: TextEncodingSchema,
  encodingConfidence: num({ min: 0, max: 1 }),
  importedAt: str({ min: 1, max: 80 }),
});

const MoneyRefSchema: Parser<ImportEstimate["moneyRef"]> = (value, path = "$") => {
  if (value === null) return null;
  return obj({
    min: num({ min: 0 }),
    max: num({ min: 0 }),
    currency: str({ min: 1, max: 20 }),
  })(value, path);
};

export const ImportEstimateSchema: Parser<ImportEstimate> = obj({
  chunks: int({ min: 0 }),
  tokens: obj({
    inputMin: int({ min: 0 }),
    inputMax: int({ min: 0 }),
    outputMin: int({ min: 0 }),
    outputMax: int({ min: 0 }),
  }),
  moneyRef: MoneyRefSchema,
  model: str({ min: 1, max: 200 }),
  runBudget: int({ min: 0 }),
});

export const ImportBatchViewSchema: Parser<ImportBatchView> = obj({
  duplicateOf: opt(id),
  encodingCandidates: opt(
    arr(
      obj({
        encoding: TextEncodingSchema,
        score: num({ min: 0, max: 1 }),
        preview: str({ max: 500 }),
      }),
    ),
  ),
  batch: id,
  status: lit("staged", "running", "reviewing", "partial", "closed", "reverted"),
  source: ImportSourceMetaSchema,
  segments: arr(
    obj({
      id,
      title: str({ max: 200 }),
      level: int({ min: 1, max: 6 }),
      kind: SectionKindSchema,
      paras: int({ min: 0 }),
      selected: bool,
    }),
  ),
  estimate: opt(ImportEstimateSchema),
  runId: opt(id),
  failedChunks: arr(int({ min: 0 })),
  counts: opt(record(int({ min: 0 }))),
});

export const ImportProposalSchema: Parser<ImportProposal> = obj({
  format: lit(FORMAT_VERSION),
  batch: id,
  run: id,
  libRevs: BibleIndexFilesSchema,
  items: arr(PendingItemSchema),
  unassigned: arr(obj({ src: arr(str({ max: 40 }), { max: 20 }), reason: str({ max: 500 }) })),
  failedChunks: arr(int({ min: 0 })),
  stats: obj({
    total: int({ min: 0 }),
    byChange: record(int({ min: 0 })),
    byBand: record(int({ min: 0 })),
    located: int({ min: 0 }),
    fuzzy: int({ min: 0 }),
    unlocated: int({ min: 0 }),
  }),
});

export const ImportFailReasonSchema: Parser<ImportFailReason> = lit(
  "encoding_unsupported",
  "file_type",
  "file_too_large",
  "too_long_select_sections",
  "token_expired",
  "batch_closed",
  "proposal_stale",
  "preview_stale",
);
