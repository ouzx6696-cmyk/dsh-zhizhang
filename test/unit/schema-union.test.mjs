import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { union, obj, lit, str, int } = await importTs("packages/core/src/schema/index.ts");

const ItemSchema = union("type", {
  chapter: obj({
    type: lit("chapter"),
    title: str({ min: 1, max: 60 }),
    position: int({ min: 1 }),
  }),
  entity: obj({ type: lit("entity"), name: str({ min: 1 }) }),
});

test("判别联合遇合法成员 → 解析成功且字段完整", () => {
  assert.deepEqual(ItemSchema({ type: "chapter", title: "柴房里的残卷", position: 3 }), {
    type: "chapter",
    title: "柴房里的残卷",
    position: 3,
  });
  assert.deepEqual(ItemSchema({ type: "entity", name: "林砚" }), { type: "entity", name: "林砚" });
});

test("判别联合遇未知 tag → input.invalid 且 data.path 指向该字段", () => {
  assert.throws(
    () => ItemSchema({ type: "volume", title: "第一卷" }),
    (err) => {
      assert.equal(err.code, "input.invalid");
      assert.equal(err.data.path, "$.type");
      return true;
    },
  );
});

test("判别联合遇成员多余键 → input.invalid 且 data.path 指向该键", () => {
  assert.throws(
    () => ItemSchema({ type: "entity", name: "林砚", extra: 1 }),
    (err) => {
      assert.equal(err.code, "input.invalid");
      assert.equal(err.data.path, "$.extra");
      return true;
    },
  );
});

test("判别联合遇非对象 → input.invalid", () => {
  for (const value of [null, [], "entity", 42]) {
    assert.throws(
      () => ItemSchema(value),
      (err) => {
        assert.equal(err.code, "input.invalid");
        assert.equal(err.data.path, "$");
        return true;
      },
    );
  }
});
