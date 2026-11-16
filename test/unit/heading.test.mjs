import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { joinLeadHeading, splitLeadHeading } = await importTs(
  "packages/workbench/src/manuscript/heading.ts",
);

test("正文首行 # 标题 → 拆为 title 与 rest；无标题 → hadHeading=false", () => {
  const body = "# 第一章 雨夜\n\n正文从码头开始。";
  const split = splitLeadHeading(body);
  assert.equal(split.hadHeading, true);
  assert.equal(split.title, "第一章 雨夜");
  assert.equal(split.rest, "\n正文从码头开始。");
  assert.equal(joinLeadHeading(split.title, split.rest), body);

  const plain = "正文直接开始，没有标题行。";
  const noHeading = splitLeadHeading(plain);
  assert.deepEqual(noHeading, { rest: plain, hadHeading: false });
  assert.equal("title" in noHeading, false);
});

test("CRLF 正文拆分与拼回逐字一致", () => {
  const body = "# 第一章 雨夜\r\n\r\n正文从码头开始。\r\n第二段。";
  const split = splitLeadHeading(body);
  assert.equal(split.hadHeading, true);
  assert.equal(split.title, "第一章 雨夜");
  assert.equal(joinLeadHeading(split.title, split.rest), body);
});

test("前置空行、二级标题与 # 后无空格都不算首行标题", () => {
  const secondLevel = splitLeadHeading("## 小节标题\n\n正文。");
  assert.equal(secondLevel.hadHeading, false);

  const noSpace = splitLeadHeading("#没有空格的标题\n\n正文。");
  assert.equal(noSpace.hadHeading, false);

  const leadingBlanks = splitLeadHeading("\n\n# 第一章 雨夜\n正文。");
  assert.equal(leadingBlanks.hadHeading, true);
  assert.equal(leadingBlanks.title, "第一章 雨夜");
});

test("只有标题行、标题行无行尾时拆分与拼回仍成立", () => {
  const onlyHeading = splitLeadHeading("# 第一章 雨夜");
  assert.equal(onlyHeading.hadHeading, true);
  assert.equal(joinLeadHeading(onlyHeading.title, onlyHeading.rest), "# 第一章 雨夜");

  const noEol = splitLeadHeading("# 第一章 雨夜\n正文。");
  assert.equal(noEol.rest, "正文。");
  assert.equal(joinLeadHeading(noEol.title, noEol.rest), "# 第一章 雨夜\n正文。");
});

test("joinLeadHeading 空标题返回原 rest，不插入 # 行", () => {
  const rest = "\n正文。";
  assert.equal(joinLeadHeading("", rest), rest);
  assert.equal(joinLeadHeading("   ", rest), rest);
});
