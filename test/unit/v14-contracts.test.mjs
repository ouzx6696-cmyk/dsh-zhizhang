import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const ROOT = process.cwd();
const schema = await importTs("packages/core/src/schema/index.ts");
const outline = await importTs("packages/fanqie/src/outline/index.ts");
const bible = await importTs("packages/fanqie/src/bible/index.ts");
const importer = await importTs("packages/fanqie/src/import/index.ts");
const text = await importTs("packages/core/src/text/index.ts");
const contract = await importTs("packages/workbench/src/contract/index.ts");

const fixture = (name) =>
  JSON.parse(fs.readFileSync(path.join(ROOT, "test", "fixtures", "contracts", name), "utf8"));
const clone = (value) => structuredClone(value);

function hasUndefined(value) {
  if (Array.isArray(value)) return value.some(hasUndefined);
  if (value !== null && typeof value === "object") {
    return Object.entries(value).some(([, item]) => item === undefined || hasUndefined(item));
  }
  return false;
}

function roundtrip(parser, sample, label) {
  const parsed = parser(sample);
  const dropped = schema.dropUndefined(parsed);
  assert.equal(hasUndefined(dropped), false, `${label}: 落盘值不得含 undefined`);
  const again = schema.dropUndefined(parser(JSON.parse(JSON.stringify(dropped))));
  assert.deepEqual(again, dropped, `${label}: 解析 → 落盘 → 再解析应相等`);
  return dropped;
}

function expectInvalid(parser, value, dataPath, label) {
  assert.throws(
    () => parser(value),
    (err) => {
      assert.equal(err.code, "input.invalid", `${label}: 应为 input.invalid`);
      assert.equal(err.data.path, dataPath, `${label}: data.path`);
      return true;
    },
  );
}

const provenance = { source: "author", at: "2026-11-17T00:00:00.000Z" };
const node = {
  id: "vol-00000001",
  title: "第一卷",
  planStatus: "draft",
  provenance,
  rev: 0,
};
const chapter = {
  ...node,
  id: "pl-00000001",
  title: "第一章",
};

test("BookFile / VolumeFile / ChapterPlan 解析器：合法 roundtrip，未知键与越界报错", () => {
  const book = fixture("book.json");
  roundtrip(outline.BookFileSchema, book, "BookFile");
  const volume = { ...node, format: "zhizhang/1.3", acts: [] };
  roundtrip(outline.VolumeFileSchema, volume, "VolumeFile");
  roundtrip(outline.ChapterPlanSchema, chapter, "ChapterPlan");

  expectInvalid(
    outline.BookFileSchema,
    { ...clone(book), extra: true },
    "$.extra",
    "BookFile unknown key",
  );
  expectInvalid(
    outline.BookFileSchema,
    { ...clone(book), title: "长".repeat(101) },
    "$.title",
    "BookFile title",
  );
});

test("OutlineOp 全部 13 个 type：合法样例可解析，未知 type 与缺字段报错", () => {
  const ops = [
    { type: "node.create", level: "chapter", index: 0, node: chapter },
    { type: "node.update", id: chapter.id, patch: { title: "新标题" }, expectedRev: 0 },
    { type: "node.delete", id: chapter.id, expectedRev: 1 },
    { type: "node.move", ids: [chapter.id], index: 0 },
    {
      type: "chapter.split",
      id: chapter.id,
      parts: [chapter, { ...chapter, id: "pl-00000002" }],
    },
    { type: "chapter.merge", ids: [chapter.id, "pl-00000002"], into: chapter },
    { type: "act.split", id: "act-1", at: 1, newNode: node },
    { type: "volume.split", id: "vol-1", at: 1, newNode: node },
    { type: "act.merge", ids: ["act-1", "act-2"] },
    { type: "volume.merge", ids: ["vol-1", "vol-2"] },
    { type: "chapter.bind", plan: chapter.id, chapterId: "ch-001" },
    { type: "chapter.unbind", plan: chapter.id },
    { type: "book.update", patch: { title: "新书名" }, expectedRev: 2 },
  ];
  for (const op of ops) roundtrip(outline.OutlineOpSchema, op, `OutlineOp ${op.type}`);

  expectInvalid(outline.OutlineOpSchema, { type: "bogus" }, "$.type", "unknown OutlineOp");
  expectInvalid(
    outline.OutlineOpSchema,
    { type: "node.delete", id: "pl-1" },
    "$.expectedRev",
    "missing expectedRev",
  );
});

test("设定集实体 / 时间线 / 状态 / 线索 / 知情表：合法 roundtrip，越界报错", () => {
  const sample = fixture("bible.json");
  roundtrip(bible.BibleSnapshotSchema, sample, "BibleSnapshot");

  const badKind = clone(sample);
  badKind.entities[0].kind = "god";
  expectInvalid(bible.BibleSnapshotSchema, badKind, "$.entities[0].kind", "entity kind");

  const badLevel = clone(sample);
  badLevel.knowledge[0].level = "全知";
  expectInvalid(bible.BibleSnapshotSchema, badLevel, "$.knowledge[0].level", "knowledge level");
});

test("BibleOp 全部 12 个 type：合法样例可解析，未知 type 与缺字段报错", () => {
  const sample = fixture("bible.json");
  const ledger = fixture("ledger.json");
  const ops = [
    { type: "entity.upsert", entity: sample.entities[0] },
    { type: "entity.merge", keep: "ent-a", drop: "ent-b" },
    { type: "entity.delete", id: "ent-a", expectedRev: 0 },
    { type: "timeline.upsert", event: sample.timeline[0] },
    { type: "state.add", entry: sample.states[0] },
    { type: "state.update", id: "st-1", patch: { value: "炼气四层" }, expectedRev: 0 },
    { type: "state.delete", id: "st-1", expectedRev: 0 },
    { type: "thread.upsert", thread: sample.threads[0] },
    { type: "thread.beat", thread: "th-1", beat: { chapter: 2, kind: "push", note: "再次发光" } },
    { type: "knowledge.set", row: sample.knowledge[0] },
    { type: "ledger.write", entry: ledger },
    { type: "style.update", patch: { contract: "更冷" } },
  ];
  for (const op of ops) roundtrip(bible.BibleOpSchema, op, `BibleOp ${op.type}`);

  expectInvalid(bible.BibleOpSchema, { type: "bogus" }, "$.type", "unknown BibleOp");
  expectInvalid(
    bible.BibleOpSchema,
    { type: "entity.delete", id: "ent-a" },
    "$.expectedRev",
    "missing expectedRev",
  );
});

test("PendingItem / PendingBatch / ChangeSet：合法 roundtrip，枚举越界报错", () => {
  const pending = fixture("pending.json");
  roundtrip(bible.PendingBatchSchema, pending, "PendingBatch");
  roundtrip(bible.PendingItemSchema, pending.items[0], "PendingItem");

  const badChange = clone(pending);
  badChange.items[0].change = "maybe";
  expectInvalid(bible.PendingBatchSchema, badChange, "$.items[0].change", "pending change");

  const changeset = fixture("changeset.json");
  roundtrip(bible.ChangeSetSchema, changeset, "ChangeSet");
  expectInvalid(
    bible.ChangeSetSchema,
    { ...clone(changeset), kind: "undo" },
    "$.kind",
    "changeset kind",
  );
});

test("DocMap / ExtractResult / LedgerEntry：合法 roundtrip，越界与超量报错", () => {
  const imported = fixture("import.json");
  roundtrip(importer.DocMapSchema, imported.docmap, "DocMap");
  roundtrip(importer.ExtractResultSchema, imported.extract, "ExtractResult");

  const badKind = clone(imported.docmap);
  badKind.sections[1].kind = "setting-god";
  expectInvalid(importer.DocMapSchema, badKind, "$.sections[1].kind", "section kind");

  expectInvalid(
    importer.ExtractResultSchema,
    { items: Array.from({ length: 81 }, () => imported.extract.items[0]), unassigned: [] },
    "$.items",
    "extract items max",
  );

  const ledger = fixture("ledger.json");
  roundtrip(bible.LedgerEntrySchema, ledger, "LedgerEntry");
  expectInvalid(
    bible.LedgerEntrySchema,
    { ...clone(ledger), facts: Array.from({ length: 61 }, () => ledger.facts[0]) },
    "$.facts",
    "ledger facts max",
  );
});

test("Segment / Chunk / EncodingGuess：合法 roundtrip，level 与 encoding 越界报错", () => {
  const sample = fixture("text.json");
  roundtrip(text.EncodingGuessSchema, sample.encodingGuess, "EncodingGuess");
  roundtrip(text.SegmentSchema, sample.segment, "Segment");
  roundtrip(text.ChunkSchema, sample.chunk, "Chunk");

  expectInvalid(
    text.SegmentSchema,
    { ...clone(sample.segment), level: 7 },
    "$.level",
    "segment level",
  );
  expectInvalid(
    text.EncodingGuessSchema,
    { ...clone(sample.encodingGuess), encoding: "koi8-r" },
    "$.encoding",
    "encoding",
  );
});

test("命令契约：68 条命令、decide 已删除、刷新范围合法", () => {
  const all = Object.keys(contract.COMMAND_POLICY);
  assert.equal(all.length, 68);
  assert.equal(all.includes("fanqie.bible.decide"), false);
  assert.equal(all.includes("fanqie.pending.decide"), true);
  const scopes = new Set([
    "rows",
    "chapter",
    "bible",
    "article",
    "profiles",
    "library",
    "outline",
    "imports",
    "pending",
  ]);
  for (const [command, policy] of Object.entries(contract.COMMAND_POLICY)) {
    assert.ok(policy.access === "read" || policy.access === "write", command);
    const refresh = Array.isArray(policy.refresh)
      ? policy.refresh
      : policy.refresh
        ? [policy.refresh]
        : [];
    for (const scope of refresh) assert.ok(scopes.has(scope), `${command}: ${scope}`);
  }
});
