import assert from "node:assert/strict";
import test from "node:test";
import { text } from "../support/v14.mjs";

test("分块覆盖全部正文段且顺序不变，衔接段只进 contextOnly", () => {
  const result = text.segment("# 开篇\n甲乙丙。\n\n丁戊己。\n\n庚辛壬。\n\n癸子丑。", {
    format: "md",
  });
  const chunks = text.chunk(result, { maxTokens: 12, overlapParas: 1, estimate: (s) => s.length });
  assert.deepEqual(
    chunks.flatMap((chunk) => chunk.paras),
    result.segments.flatMap((segment) => segment.paras.map((para) => para.id)),
  );
  assert.ok(chunks.length > 1 && chunks.some((chunk) => chunk.contextOnly.length));
  for (const chunk of chunks) {
    assert.ok(chunk.tokens <= 12);
    assert.ok(chunk.paras.every((id) => !chunk.contextOnly.includes(id)));
  }
  assert.equal(chunks.at(-1).total, chunks.length);
});
test("超长段按句 / 字符切片，原结果不变且偏移完整覆盖", () => {
  const result = text.segment("# 夜航\n" + "长段没有标点😀".repeat(20), { format: "md" }),
    before = structuredClone(result);
  const original = result.segments[0].paras[0],
    chunks = text.chunk(result, { maxTokens: 17, overlapParas: 0, estimate: (s) => s.length });
  const fragments = chunks.flatMap((chunk) => chunk.fragments ?? []);
  assert.ok(fragments.length > 1);
  assert.deepEqual(result, before);
  assert.equal(
    fragments.map((part) => result.text.slice(part.start, part.end)).join(""),
    result.text.slice(original.start, original.end),
  );
  assert.ok(chunks.every((chunk) => chunk.tokens <= 17 && !chunk.contextOnly.length));
  assert.equal(new Set(fragments.map((part) => part.id)).size, fragments.length);
});
test("完整小节优先装块，面包屑对应本块首节", () => {
  const result = text.segment("# 卷一\n1234\n\n# 卷二\n5678\n\n9012\n", { format: "md" });
  const chunks = text.chunk(result, { maxTokens: 10, estimate: (s) => s.length });
  assert.deepEqual(
    chunks.map((chunk) => chunk.segmentIds),
    [["S1"], ["S2"]],
  );
  assert.equal(chunks[1].breadcrumb, "卷二");
});
