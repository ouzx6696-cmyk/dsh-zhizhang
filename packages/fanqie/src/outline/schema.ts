/** 大纲契约的运行时解析器（F2 §2；每个类型同名 XxxSchema）。 */
import { AppError } from "@zhizhang/core/errors";
import { FORMAT_VERSION } from "@zhizhang/core/version";
import { arr, int, lit, obj, opt, str, union, type Parser } from "@zhizhang/core/schema";
import type {
  Act,
  Beat,
  BookFile,
  ChapterPlan,
  OutlineOp,
  PlanNodeBase,
  PositionMap,
  RemapPreview,
  SourceRef,
  ThreadRef,
  VolumeFile,
} from "./types.js";

const id = str({ min: 1, max: 200 });

export const ThreadRefSchema: Parser<ThreadRef> = obj({
  thread: opt(id),
  title: opt(str({ max: 60 })),
});

export const ProvenanceSchema = obj({
  source: lit("author", "plan", "import", "ledger", "assistant"),
  batch: opt(str({ max: 80 })),
  run: opt(str({ max: 200 })),
  chapter: opt(int({ min: 1 })),
  at: str({ min: 1, max: 80 }),
});

const locatedRef: Parser<SourceRef["located"]> = (value, path = "$") => {
  if (value === false) return false;
  return lit("exact", "fuzzy")(value, path);
};

export const SourceRefSchema: Parser<SourceRef> = obj({
  batch: str({ min: 1, max: 80 }),
  section: str({ min: 1, max: 40 }),
  paras: arr(str({ min: 1, max: 40 }), { max: 20 }),
  quote: str({ max: 80 }),
  located: locatedRef,
  start: opt(int({ min: 0 })),
  end: opt(int({ min: 0 })),
});

const PlanStatusSchema = lit("draft", "settled");

const PlanNodeFields = {
  id,
  title: str({ min: 1, max: 60 }),
  summary: opt(str({ max: 2000 })),
  goal: opt(str({ max: 500 })),
  conflict: opt(str({ max: 500 })),
  payoffs: opt(arr(str({ max: 120 }), { max: 10 })),
  hook: opt(str({ max: 300 })),
  plant: opt(arr(ThreadRefSchema, { max: 20 })),
  pay: opt(arr(ThreadRefSchema, { max: 20 })),
  cast: opt(arr(id, { max: 40 })),
  wordTarget: opt(int({ min: 500, max: 2_000_000 })),
  planStatus: PlanStatusSchema,
  notes: opt(str({ max: 4000 })),
  provenance: ProvenanceSchema,
  src: opt(arr(SourceRefSchema, { max: 10 })),
  rev: int({ min: 0 }),
} as const;

export const BeatSchema: Parser<Beat> = obj({
  title: str({ min: 1, max: 120 }),
  goal: str({ min: 1, max: 500 }),
  conflict: str({ min: 1, max: 500 }),
  hook: opt(str({ max: 300 })),
});

const ChapterPlanFields = {
  ...PlanNodeFields,
  chapterId: opt(id),
  pov: opt(id),
  location: opt(id),
  timeAnchor: opt(str({ max: 60 })),
  beats: opt(arr(BeatSchema, { max: 20 })),
  mustInclude: opt(arr(str({ max: 120 }), { max: 10 })),
  mustAvoid: opt(arr(str({ max: 120 }), { max: 10 })),
  emotion: opt(str({ max: 60 })),
} as const;

export const ChapterPlanSchema: Parser<ChapterPlan> = obj(ChapterPlanFields);

const PlanNodeSchema: Parser<PlanNodeBase | ChapterPlan> = obj(ChapterPlanFields);

const ChapterPlanPatchSchema: Parser<Partial<Omit<ChapterPlan, "id" | "rev" | "provenance">>> = obj(
  {
    title: opt(str({ min: 1, max: 60 })),
    summary: opt(str({ max: 2000 })),
    goal: opt(str({ max: 500 })),
    conflict: opt(str({ max: 500 })),
    payoffs: opt(arr(str({ max: 120 }), { max: 10 })),
    hook: opt(str({ max: 300 })),
    plant: opt(arr(ThreadRefSchema, { max: 20 })),
    pay: opt(arr(ThreadRefSchema, { max: 20 })),
    cast: opt(arr(id, { max: 40 })),
    wordTarget: opt(int({ min: 500, max: 2_000_000 })),
    planStatus: opt(PlanStatusSchema),
    notes: opt(str({ max: 4000 })),
    src: opt(arr(SourceRefSchema, { max: 10 })),
    chapterId: opt(id),
    pov: opt(id),
    location: opt(id),
    timeAnchor: opt(str({ max: 60 })),
    beats: opt(arr(BeatSchema, { max: 20 })),
    mustInclude: opt(arr(str({ max: 120 }), { max: 10 })),
    mustAvoid: opt(arr(str({ max: 120 }), { max: 10 })),
    emotion: opt(str({ max: 60 })),
  },
);

const BookPatchSchema: Parser<Partial<Omit<BookFile, "format" | "volumeOrder" | "rev">>> = obj({
  title: opt(str({ min: 1, max: 100 })),
  logline: opt(str({ max: 300 })),
  coreConflict: opt(str({ max: 1000 })),
  sellingPoints: opt(arr(str({ max: 120 }), { max: 10 })),
  wordTarget: opt(int({ min: 500, max: 2_000_000 })),
});

export const ActSchema: Parser<Act> = obj({
  ...PlanNodeFields,
  chapters: arr(ChapterPlanSchema, { max: 400 }),
});

export const VolumeFileSchema: Parser<VolumeFile> = obj({
  ...PlanNodeFields,
  format: lit(FORMAT_VERSION),
  acts: arr(ActSchema, { max: 60 }),
});

export const BookFileSchema: Parser<BookFile> = obj({
  format: lit(FORMAT_VERSION),
  title: str({ min: 1, max: 100 }),
  logline: opt(str({ max: 300 })),
  coreConflict: opt(str({ max: 1000 })),
  sellingPoints: opt(arr(str({ max: 120 }), { max: 10 })),
  wordTarget: opt(int({ min: 500, max: 2_000_000 })),
  volumeOrder: arr(id, { max: 60 }),
  rev: int({ min: 0 }),
});

const stringPair: Parser<[string, string]> = (value, path = "$") => {
  const list = arr(id, { max: 2 })(value, path);
  if (list.length !== 2) {
    throw new AppError("input.invalid", `${path}: expected 2 items`, { path });
  }
  return [list[0], list[1]];
};

export const OutlineOpSchema: Parser<OutlineOp> = union("type", {
  "node.create": obj({
    type: lit("node.create"),
    level: lit("volume", "act", "chapter"),
    parent: opt(id),
    index: int({ min: 0 }),
    node: PlanNodeSchema,
  }),
  "node.update": obj({
    type: lit("node.update"),
    id,
    patch: ChapterPlanPatchSchema,
    expectedRev: int({ min: 0 }),
  }),
  "node.delete": obj({ type: lit("node.delete"), id, expectedRev: int({ min: 0 }) }),
  "node.move": obj({
    type: lit("node.move"),
    ids: arr(id, { min: 1, max: 50 }),
    parent: opt(id),
    index: int({ min: 0 }),
  }),
  "chapter.split": obj({
    type: lit("chapter.split"),
    id,
    parts: arr(ChapterPlanSchema, { min: 2, max: 400 }),
  }),
  "chapter.merge": obj({
    type: lit("chapter.merge"),
    ids: arr(id, { min: 2, max: 50 }),
    into: ChapterPlanSchema,
  }),
  "act.split": obj({
    type: lit("act.split"),
    id,
    at: int({ min: 1 }),
    newNode: PlanNodeSchema,
  }),
  "volume.split": obj({
    type: lit("volume.split"),
    id,
    at: int({ min: 1 }),
    newNode: PlanNodeSchema,
  }),
  "act.merge": obj({ type: lit("act.merge"), ids: stringPair }),
  "volume.merge": obj({ type: lit("volume.merge"), ids: stringPair }),
  "chapter.bind": obj({ type: lit("chapter.bind"), plan: id, chapterId: id }),
  "chapter.unbind": obj({ type: lit("chapter.unbind"), plan: id }),
  "book.update": obj({
    type: lit("book.update"),
    patch: BookPatchSchema,
    expectedRev: int({ min: 0 }),
  }),
});

export const PositionMapSchema: Parser<PositionMap> = arr(
  obj({ from: int({ min: 0 }), to: int({ min: 0 }) }),
);

export const RemapPreviewSchema: Parser<RemapPreview> = obj({
  moves: arr(
    obj({
      id,
      title: str({ min: 1, max: 60 }),
      from: int({ min: 0 }),
      to: int({ min: 0 }),
    }),
  ),
  affected: arr(
    obj({
      file: lit("states", "threads", "knowledge", "ledger", "timeline"),
      id,
      label: str({ min: 1, max: 200 }),
      field: lit(
        "since",
        "until",
        "opened",
        "plannedPayoff",
        "dueBy",
        "beat",
        "position",
        "chapter",
      ),
      from: int({ min: 0 }),
      to: int({ min: 0 }),
    }),
  ),
  invalid: arr(obj({ id, reason: lit("until_le_since", "pay_before_plant") })),
  token: str({ min: 1, max: 200 }),
});
