/**
 * WorkbenchCommand 输入边界校验表（50 条命令与 WorkbenchCommand 编译期一一对应）。
 */
import { AppError } from "@zhizhang/core/errors";
import { arr, bool, int, lit, num, obj, opt, str, type Parser } from "@zhizhang/core/schema";
import type { BibleOp, Provenance } from "@zhizhang/fanqie";
import type { CommandInput, WorkbenchCommand } from "@zhizhang/workbench/contract";
import { PROFILE_INPUTS } from "./commands-profiles.js";

const id = str({ min: 1, max: 200 });
const grade = lit("economy", "standard", "premium");
const BIBLE_OP_TYPES = [
  "entity.upsert",
  "state.add",
  "thread.upsert",
  "knowledge.set",
  "chapter.record",
] as const;
const BIBLE_OP_KEYS: Record<(typeof BIBLE_OP_TYPES)[number], string> = {
  "entity.upsert": "entity",
  "state.add": "entry",
  "thread.upsert": "thread",
  "knowledge.set": "row",
  "chapter.record": "record",
};

/** 设定集增量只做结构校验（类型 + 载荷对象），字段语义由设定集存储在写入时裁定。 */
const bibleOp: Parser<BibleOp> = (value, at = "$") => {
  const shape = obj({ type: lit(...BIBLE_OP_TYPES) }, { strict: false })(value, at);
  const key = BIBLE_OP_KEYS[shape.type];
  const payload: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new AppError("input.invalid", `${at}.${key}: expected object`, { path: `${at}.${key}` });
  }
  return value as BibleOp;
};

const provenance: Parser<Provenance> = obj({
  source: lit("plan", "ledger", "author"),
  run: opt(str()),
  chapter: opt(int({ min: 1 })),
  at: str({ min: 1 }),
});

const decision: Parser<"accept" | "reject" | { edit: BibleOp }> = (value, at = "$") =>
  value === "accept" || value === "reject" ? value : obj({ edit: bibleOp })(value, at);

const techniqueCardInput = obj({
  id: str({ min: 1, max: 120 }),
  title: str({ min: 1, max: 200 }),
  category: str({ min: 1, max: 80 }),
  pattern: str({ min: 1, max: 4000 }),
  example: str({ max: 4000 }),
  usage: str({ max: 2000 }),
  layer: opt(lit("book", "arc", "unit", "chapter", "scene", "line")),
  dimension: opt(lit("structure", "character", "rhythm", "hook", "prose", "commercial")),
  readerWant: opt(str({ max: 1000 })),
  emotionArc: opt(str({ max: 1000 })),
  dramaticUnit: opt(str({ max: 1000 })),
  replaceables: opt(arr(str({ max: 400 }), { max: 40 })),
  mustNotCopy: opt(arr(str({ max: 400 }), { max: 40 })),
  transfer: opt(str({ max: 2000 })),
  failWhen: opt(str({ max: 2000 })),
  steps: opt(arr(str({ max: 600 }), { max: 30 })),
  bannedDiction: opt(arr(str({ max: 200 }), { max: 40 })),
  quoteStatus: opt(lit("verified", "partial", "unverified")),
  quoteLine: opt(int({ min: 1 })),
});

export const COMMAND_INPUTS: { [K in WorkbenchCommand]: Parser<CommandInput<K>> } = {
  "fanqie.snapshot": obj({ work: id, since: opt(str()) }),
  "fanqie.chapter.list": obj({ work: id }),
  "fanqie.chapter.get": obj({ work: id, chapter: id }),
  "fanqie.chapter.save": obj({
    work: id,
    chapter: id,
    base: str(),
    body: str({ max: 2_000_000 }),
    title: opt(str({ max: 100, trim: true })),
  }),
  "fanqie.chapter.finalize": obj({ work: id, chapter: id, base: opt(str()) }),
  "fanqie.candidate.list": obj({ work: id, chapter: opt(id) }),
  "fanqie.candidate.get": obj({ work: id, chapter: id, candidateId: id }),
  "fanqie.candidate.accept": obj({ work: id, chapter: id, candidateId: id, base: str() }),
  "fanqie.candidate.reject": obj({
    work: id,
    chapter: id,
    candidateId: id,
    reason: opt(str({ max: 2000 })),
  }),
  "fanqie.work.list": obj({ root: id }),
  "fanqie.work.get": obj({ work: id }),
  "fanqie.work.create": obj({
    root: id,
    title: str({ min: 1, max: 100, trim: true }),
    premise: str({ max: 20000 }),
    grade,
  }),
  "fanqie.work.previewLegacy": obj({
    root: id,
    sourcePath: id,
    sourceKind: lit("single_txt", "folder"),
  }),
  "fanqie.work.importLegacy": obj({
    root: id,
    title: str({ min: 1, max: 100, trim: true }),
    sourcePath: id,
    sourceKind: lit("single_txt", "folder"),
    grade: opt(grade),
    chapterStatus: opt(lit("drafted", "final")),
  }),
  "fanqie.work.settings": obj({
    work: id,
    grade: opt(grade),
    profile: opt(id),
    requireEditorPass: opt(bool),
    targetWords: opt(int({ min: 500, max: 20000 })),
    previousTextMode: opt(lit("auto", "full", "tail")),
    publishedThrough: opt(str({ max: 60 })),
    dailyTargetChars: opt(num({ min: 500, max: 50000 })),
  }),
  "fanqie.book.export": obj({ work: id, format: lit("txt", "docx"), finalOnly: bool, outPath: id }),
  "fanqie.bible.get": obj({ work: id }),
  "fanqie.bible.view": obj({ work: id, position: int({ min: 1 }) }),
  "fanqie.bible.propose": obj({ work: id, ops: arr(bibleOp, { max: 200 }), from: provenance }),
  "fanqie.bible.decide": obj({ work: id, id, decision }),
  "fanqie.bible.audit": obj({ work: id, upTo: int({ min: 1 }) }),
  "fanqie.bible.trace": obj({
    work: id,
    query: str({ min: 1, max: 120 }),
    includeBody: opt(bool),
    maxBodyHits: opt(int({ min: 1, max: 100 })),
  }),
  "fanqie.reference.bind": obj({
    work: id,
    sourceId: id,
    cardIds: opt(arr(id, { max: 200 })),
    scope: opt(lit("work", "chapter")),
    chapterId: opt(id),
  }),
  "fanqie.reference.list": obj({ work: id }),
  "toutiao.articles": obj({ root: id }),
  "toutiao.article.create": obj({ root: id, genre: id, driver: id }),
  "toutiao.article.transition": obj({ articleDir: id, to: id }),
  "toutiao.article.deliver": obj({
    articleDir: id,
    title: str({ min: 1, max: 200 }),
    body: str({ min: 1, max: 400_000 }),
    expectedRevision: opt(str()),
  }),
  "toutiao.article.export": obj({
    articleDir: id,
    outPath: id,
    format: opt(lit("md", "txt")),
    includeDelivery: opt(bool),
  }),
  "toutiao.draft.get": obj({ articleDir: id }),
  "toutiao.draft.save": obj({
    articleDir: id,
    title: opt(str({ max: 200 })),
    body: str({ min: 1, max: 400_000 }),
    revision: opt(str()),
  }),
  "toutiao.source.register": obj({
    articleDir: id,
    sourceId: id,
    kind: lit("paste", "file", "classic"),
    content: str({ min: 1, max: 2_000_000 }),
  }),
  "toutiao.ledger.show": obj({ ledgerPath: id, last: opt(int({ min: 1, max: 200 })) }),
  "toutiao.ledger.add": obj({
    cardPath: id,
    ledgerPath: id,
    articleId: opt(id),
    status: opt(id),
    date: opt(id),
  }),
  "toutiao.ledger.status": obj({ title: id, to: id, ledgerPath: id, articleId: opt(id) }),
  "toutiao.metrics.import": obj({
    articleId: id,
    metricsJson: str({ min: 1, max: 400_000 }),
    ledgerPath: id,
    url: opt(str()),
  }),
  ...PROFILE_INPUTS,
  "library.import": obj({
    libraryRoot: id,
    id: str({ min: 1, max: 80 }),
    title: str({ min: 1, max: 200 }),
    content: str({ min: 1, max: 20_000_000 }),
  }),
  "library.list": obj({ libraryRoot: id }),
  "library.cards": obj({ libraryRoot: id, sourceId: id }),
  "library.cards.save": obj({
    libraryRoot: id,
    sourceId: id,
    cards: arr(techniqueCardInput, { max: 100 }),
  }),
  "library.dissect": obj({
    libraryRoot: id,
    sourceId: id,
    title: str({ min: 1, max: 200 }),
    sourcePath: opt(id),
  }),
};
