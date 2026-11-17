import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";
import { provenance } from "../support/v14.mjs";

const { resolveItems } = await importTs("packages/fanqie/src/import/resolve.ts");
const emptyBible = () => ({
  entities: [],
  timeline: [],
  states: [],
  threads: [],
  knowledge: [],
  style: { contract: "", rules: [], voiceSamples: [] },
});
const emptyOutline = () => ({ book: { volumeOrder: [] }, volumes: new Map() });
const docmap = { sections: [{ id: "S1", kind: "setting-character" }] };
function located(item, paragraphText) {
  return {
    item: { tmp: "c0:item", src: ["P1.1"], quote: item.name, confidence: 0.9, ...item },
    hit: {
      located: "exact",
      para: "P1.1",
      start: 0,
      end: item.name.length,
      score: 1,
      text: item.name,
    },
    paragraphText,
    chunk: 0,
  };
}

test("同名实体的年龄等关键属性冲突时分配不同实体并标出第二个", () => {
  const items = [
    located(
      { type: "entity", tmp: "first", kind: "character", name: "林川", attributes: { 年龄: "20" } },
      "林川二十岁。",
    ),
    located(
      {
        type: "entity",
        tmp: "second",
        kind: "character",
        name: "林川",
        attributes: { 年龄: "40" },
      },
      "林川四十岁。",
    ),
  ];
  items[0].item.tmp = "c0:first";
  items[1].item.tmp = "c1:second";
  const result = resolveItems(
      items,
      emptyBible(),
      emptyOutline(),
      "imp-00000001",
      "run-1",
      docmap,
      "now",
      undefined,
      [],
    ),
    entities = result.filter((item) => item.op.type === "entity.upsert");
  assert.equal(entities.length, 2);
  assert.notEqual(entities[0].op.entity.id, entities[1].op.entity.id);
  assert.equal(entities[0].op.entity.name, "林川");
  assert.equal(entities[1].op.entity.name, "林川（二）");
  assert.ok(entities[1].notes.includes("import.same_name_separate"));
});

test("模糊候选只在原文同段出现时利用共现分数", () => {
  const candidate = {
    id: "ent-linhe",
    kind: "character",
    name: "林河儿",
    aliases: [],
    summary: "",
    attributes: { 年龄: "40" },
    locked: [],
    provenance,
    rev: 0,
  };
  const resolve = (paragraphText) =>
    resolveItems(
      [
        located(
          { type: "entity", kind: "character", name: "林川儿", attributes: { 年龄: "20" } },
          paragraphText,
        ),
      ],
      { ...emptyBible(), entities: [candidate] },
      emptyOutline(),
      "imp-00000001",
      "run-1",
      docmap,
      "now",
    )[0];
  assert.ok(resolve("林川儿和林河儿同时来到渡口").notes.includes("import.ambiguous_name"));
  assert.ok(!resolve("林川儿独自来到渡口").notes.includes("import.ambiguous_name"));
});

test("locateExtract 为共现判断附带实际命中段落", async () => {
  const { locateExtract } = await importTs("packages/fanqie/src/import/extract.ts"),
    text = "林川与林河在渡口相遇。",
    para = { id: "P1.1", start: 0, end: text.length, hash: "x" },
    [hit] = locateExtract(
      text,
      [para],
      [
        {
          type: "entity",
          tmp: "x",
          kind: "character",
          name: "林川",
          src: ["P1.1"],
          quote: "林川",
          confidence: 0.9,
        },
      ],
      0,
    );
  assert.equal(hit.paragraphText, text);
});
