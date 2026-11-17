import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { dropUndefined } = await importTs("packages/core/src/schema/index.ts");
const { obj, opt, str, arr, int } = await importTs("packages/core/src/schema/index.ts");

const ChapterSchema = obj({
  id: str(),
  title: str(),
  summary: opt(str()),
  beats: opt(arr(str())),
  position: opt(int()),
});

test("opt 字段解析后带 undefined → dropUndefined 后落盘不含该键", () => {
  const parsed = ChapterSchema({ id: "pl-1", title: "第一章" });
  assert.equal("summary" in parsed, true);
  assert.equal(parsed.summary, undefined);

  const clean = dropUndefined(parsed);
  const json = JSON.stringify(clean);
  assert.equal(json.includes("summary"), false);
  assert.equal(json.includes("beats"), false);
  assert.equal(json.includes("position"), false);
  assert.deepEqual(Object.keys(clean), ["id", "title"]);
});

test("dropUndefined 保留 null、false、0 与空数组", () => {
  const value = { a: null, b: false, c: 0, d: [], e: "", f: undefined };
  assert.deepEqual(dropUndefined(value), { a: null, b: false, c: 0, d: [], e: "" });
});

test("dropUndefined 递归处理嵌套对象与对象数组，不改变键序", () => {
  const value = { z: 1, a: { keep: 1, drop: undefined }, list: [{ x: undefined, y: 2 }, { y: 3 }] };
  const clean = dropUndefined(value);
  assert.deepEqual(Object.keys(clean), ["z", "a", "list"]);
  assert.deepEqual(clean, { z: 1, a: { keep: 1 }, list: [{ y: 2 }, { y: 3 }] });
});

test("dropUndefined 不修改入参", () => {
  const value = { keep: 1, drop: undefined };
  dropUndefined(value);
  assert.equal("drop" in value, true);
});
