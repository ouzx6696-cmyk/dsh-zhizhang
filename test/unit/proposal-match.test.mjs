import assert from "node:assert/strict";
import test from "node:test";
import { matchProposals, normalizeMatchKey } from "../support/proposal-match.mjs";

const expected = {
  items: [
    {
      type: "entity",
      kind: "character",
      name: "林砚",
      aliases: ["砚哥"],
      fields: { "attributes.年龄": "十六" },
    },
    {
      type: "chapter",
      title: "柴房里的残卷",
      parent: "杂役之辱",
      fields: { hook: "残卷浮现父亲的名字" },
    },
  ],
  mustNot: [{ type: "entity", name: "写作随想" }],
  stats: { minLocatedRate: 0.9 },
};

function asExtract(item) {
  const attributes = Object.fromEntries(
    Object.entries(item.fields ?? {})
      .filter(([key]) => key.startsWith("attributes."))
      .map(([key, value]) => [key.slice("attributes.".length), value]),
  );
  const direct = Object.fromEntries(
    Object.entries(item.fields ?? {}).filter(([key]) => !key.includes(".")),
  );
  return {
    ...item,
    ...direct,
    attributes,
    tmp: `tmp-${item.name ?? item.title}`,
    src: ["P1.1"],
    quote: "原文",
  };
}

test("完全相同的提案 → 匹配率 1.0 且通过", () => {
  const result = matchProposals(expected, { items: expected.items.map(asExtract) });
  assert.equal(result.matchRate, 1);
  assert.equal(result.falsePositiveRate, 0);
  assert.equal(result.passed, true);
});

test("删去一条提案 → 匹配率为 (n−1)/n", () => {
  const result = matchProposals(expected, { items: [asExtract(expected.items[0])] });
  assert.equal(result.matchRate, 0.5);
  assert.equal(result.unmatchedExpected.length, 1);
  assert.equal(result.passed, false);
});

test("多出 mustNot 条目 → 即使其余全命中也失败", () => {
  const items = expected.items.map(asExtract);
  items.push({ type: "entity", name: "写作随想", fields: {} });
  const result = matchProposals(expected, { items });
  assert.equal(result.matchRate, 1);
  assert.equal(result.mustNotHits.length, 1);
  assert.equal(result.passed, false);
});

test("别名与称谓归一化 → 同一条目；note 不计误报", () => {
  assert.equal(normalizeMatchKey(" 陈 执事！"), "陈");
  const one = { type: "entity", name: "陈烈", aliases: ["陈执事"], fields: {} };
  const result = matchProposals(
    { items: [{ type: "entity", name: "陈执事", aliases: ["陈烈"], fields: {} }], mustNot: [] },
    { items: [one, { type: "note", text: "写作随想" }] },
  );
  assert.equal(result.matchRate, 1);
  assert.equal(result.falsePositiveRate, 0);
});

test("五个字段至少命中四个 → 条目命中；只命中三个 → 不命中", () => {
  const item = { type: "entity", name: "青衡", fields: { a: "1", b: "2", c: "3", d: "4", e: "5" } };
  const four = { type: "entity", name: "青衡", a: "1", b: "2", c: "3", d: "4", e: "不同" };
  const three = { ...four, d: "不同" };
  assert.equal(matchProposals({ items: [item] }, { items: [four] }).matchRate, 1);
  assert.equal(matchProposals({ items: [item] }, { items: [three] }).matchRate, 0);
});

test("PendingItem 操作 → 解包匹配并统计 exact / fuzzy / 未定位", () => {
  const input = {
    items: [
      {
        type: "entity",
        kind: "character",
        name: "林砚",
        fields: { "attributes.身份": "记名弟子" },
      },
      { type: "state", entity: "林砚", fields: { facet: "location", value: "青岚渡" } },
      { type: "thread", title: "残卷来历", fields: { kind: "mystery" } },
    ],
  };
  const items = [
    {
      op: {
        type: "entity.upsert",
        entity: { name: "林砚", kind: "character", attributes: { 身份: "记名弟子" } },
      },
      src: [{ located: "exact" }],
    },
    {
      op: { type: "state.add", entry: { entity: "林砚", facet: "location", value: "青岚渡" } },
      src: [{ located: "fuzzy" }],
    },
    {
      op: { type: "thread.upsert", thread: { title: "残卷来历", kind: "mystery" } },
      src: [{ located: false }],
    },
  ];
  const result = matchProposals(input, { items });
  assert.equal(result.matchRate, 1);
  assert.equal(result.located.exact, 1);
  assert.equal(result.located.fuzzy, 1);
  assert.equal(result.located.unlocated, 1);
  assert.equal(result.locatedRate, 2 / 3);
});
