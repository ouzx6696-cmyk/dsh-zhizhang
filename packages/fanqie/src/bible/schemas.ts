import { arr, bool, int, lit, obj, opt, record, str, type Parser } from "@zhizhang/core/schema";
import type {
  BibleOp,
  ChapterRecord,
  Entity,
  Evidence,
  KnowledgeRow,
  PendingItem,
  Provenance,
  StateEntry,
  StyleContract,
  Thread,
} from "./types.js";

const ProvenanceSchema: Parser<Provenance> = obj(
  {
    source: lit("plan", "ledger", "author"),
    run: opt(str()),
    chapter: opt(int()),
    at: str(),
  },
  { strict: false },
);

const EvidenceSchema: Parser<Evidence> = obj(
  {
    chapter: int(),
    quote: str(),
    located: bool,
  },
  { strict: false },
);

const EntitySchema: Parser<Entity> = obj(
  {
    id: str({ min: 1 }),
    kind: lit("character", "item", "place", "faction", "rule", "term"),
    name: str(),
    aliases: arr(str()),
    matchCase: opt(bool),
    summary: str(),
    locked: arr(str()),
    global: opt(bool),
    related: opt(arr(str())),
    provenance: ProvenanceSchema,
  },
  { strict: false },
);

const StateEntrySchema: Parser<StateEntry> = obj(
  {
    id: str({ min: 1 }),
    entity: str(),
    field: str(),
    value: str(),
    since: int(),
    until: opt(int()),
    mode: lit("replace", "add"),
    status: lit("planned", "confirmed"),
    evidence: opt(EvidenceSchema),
    provenance: ProvenanceSchema,
  },
  { strict: false },
);

const ThreadSchema: Parser<Thread> = obj(
  {
    id: str({ min: 1 }),
    title: str(),
    kind: lit("foreshadow", "mystery", "promise", "debt"),
    opened: int(),
    plannedPayoff: opt(int()),
    beats: arr(
      obj(
        {
          chapter: int(),
          kind: lit("plant", "push", "pay"),
          note: str(),
          evidence: opt(EvidenceSchema),
        },
        { strict: false },
      ),
    ),
    status: lit("open", "paid", "dropped"),
  },
  { strict: false },
);

const KnowledgeRowSchema: Parser<KnowledgeRow> = obj(
  {
    id: str({ min: 1 }),
    fact: str(),
    holder: str(),
    level: lit("不知", "怀疑", "误认", "知情", "公开"),
    since: int(),
    evidence: opt(EvidenceSchema),
  },
  { strict: false },
);

const ChapterRecordSchema: Parser<ChapterRecord> = obj(
  {
    chapter: str(),
    position: int(),
    revision: str(),
    summary: str(),
    handoff: obj(
      {
        ending: str(),
        openQuestions: arr(str()),
        positions: record(str()),
        carried: arr(str()),
      },
      { strict: false },
    ),
    hook: str(),
    emotion: str(),
  },
  { strict: false },
);

export const StyleContractSchema: Parser<StyleContract> = obj(
  {
    contract: str(),
    rules: arr(
      obj(
        {
          id: str(),
          condition: str(),
          change: str(),
          why: str(),
        },
        { strict: false },
      ),
    ),
    voiceSamples: arr(str()),
  },
  { strict: false },
);

export const EntitiesFileSchema = arr(EntitySchema);
export const StatesFileSchema = arr(StateEntrySchema);
export const ThreadsFileSchema = arr(ThreadSchema);
export const KnowledgeFileSchema = arr(KnowledgeRowSchema);
export const ChaptersFileSchema = arr(ChapterRecordSchema);

const BibleOpSchema: Parser<BibleOp> = (value, at = "$") => {
  const head = obj(
    {
      type: lit("entity.upsert", "state.add", "thread.upsert", "knowledge.set", "chapter.record"),
    },
    { strict: false },
  )(value, at);
  if (head.type === "entity.upsert") {
    return obj({ type: lit("entity.upsert"), entity: EntitySchema }, { strict: false })(value, at);
  }
  if (head.type === "state.add") {
    return obj({ type: lit("state.add"), entry: StateEntrySchema }, { strict: false })(value, at);
  }
  if (head.type === "thread.upsert") {
    return obj({ type: lit("thread.upsert"), thread: ThreadSchema }, { strict: false })(value, at);
  }
  if (head.type === "knowledge.set") {
    return obj({ type: lit("knowledge.set"), row: KnowledgeRowSchema }, { strict: false })(
      value,
      at,
    );
  }
  return obj({ type: lit("chapter.record"), record: ChapterRecordSchema }, { strict: false })(
    value,
    at,
  );
};

export const PendingFileSchema: Parser<PendingItem[]> = arr(
  obj(
    {
      id: str({ min: 1 }),
      op: BibleOpSchema,
      evidence: opt(EvidenceSchema),
      located: bool,
      run: opt(str()),
      conflictsWith: opt(str()),
    },
    { strict: false },
  ),
);
