import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import { asArray, asString, asStringArray } from "../../src/tools/context.ts";

describe("参数校验 · 类型不对就硬拒（不静默降级）", () => {
  test("asStringArray：正常数组会 trim + 去空", () => {
    expect(asStringArray({ ids: [" a ", "", "b"] }, "ids")).toEqual(["a", "b"]);
  });

  test("asStringArray：缺省返回 undefined", () => {
    expect(asStringArray({}, "ids")).toBeUndefined();
  });

  test("asStringArray：字符串必须报错（曾经的静默降级 bug）", () => {
    expect(() => asStringArray({ card_ids: "card-a,card-b" }, "card_ids")).toThrow("必须是字符串数组");
  });

  test("asStringArray：required + 空数组报错", () => {
    expect(() => asStringArray({ ids: [] }, "ids", { required: true })).toThrow("不能为空");
  });

  test("asArray：对象不是数组，报错", () => {
    expect(() => asArray({ items: { a: 1 } }, "items")).toThrow("必须是数组");
  });

  test("asString：非字符串报错", () => {
    expect(() => asString({ work: 123 }, "work")).toThrow("必须是字符串");
  });
});
