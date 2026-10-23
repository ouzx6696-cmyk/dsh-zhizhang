import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import path from "node:path";
import { checkTsNocheck } from "../../scripts/ts-nocheck-guard.mjs";
import { findTypeValueImports } from "../../scripts/type-import-guard.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const src = path.join(root, "src");
const baseline = path.join(root, "scripts/ts-nocheck-baseline.json");

describe("类型安全护栏", () => {
  test("@ts-nocheck 只减不增（基线外新增即失败）", () => {
    expect(checkTsNocheck(src, baseline).newViolations).toEqual([]);
  });

  test("基线不过期（清干净的文件要从基线删掉）", () => {
    expect(checkTsNocheck(src, baseline).staleEntries).toEqual([]);
  });

  test("src 已全部去掉 @ts-nocheck（strict 全量生效）", () => {
    expect(checkTsNocheck(src, baseline).current).toEqual([]);
  });

  test("类型不能当值 import（否则运行时 SyntaxError）", () => {
    expect(findTypeValueImports(src)).toEqual([]);
  });
});
