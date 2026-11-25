import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { buildInlineDiff, buildParagraphDiff, computeDiffStats, mergeParagraphChoices } =
  await importTs("apps/desktop/src/renderer/features/workflow/compare-diff.ts");

test("buildParagraphDiff 在正文一致时返回零改动", () => {
  const text = "第一段雨夜敲门。\n\n第二段铜铃轻响。";
  const diff = buildParagraphDiff(text, text);
  assert.equal(diff.changeIndices.length, 0);
  assert.equal(diff.added, 0);
  assert.equal(diff.modified, 0);
  assert.equal(diff.removed, 0);
  assert.equal(diff.rows.length, 2);
  assert.equal(diff.rows[0].kind, "same");
});

test("buildParagraphDiff 配对改写段落并区分新增与删减", () => {
  const official = [
    "沈砚推开药铺后门，廊下风灯忽明忽暗。",
    "旧账簿放在木箱底层，页脚已经受潮发黄。",
    "这段冗余的环境描写在修订中被整段删去。",
  ].join("\n\n");
  const candidate = [
    "沈砚推开药铺后门，廊下风灯忽明忽暗。",
    "旧账簿压在木箱最底层，页脚受潮发黄，还夹着半张当票。",
    "门外传来急促的马蹄声，打断了他的思绪。",
  ].join("\n\n");

  const diff = buildParagraphDiff(official, candidate);
  assert.equal(diff.rows[0].kind, "same");
  assert.equal(diff.modified, 1);
  assert.equal(diff.removed, 1);
  assert.equal(diff.added, 1);
  assert.equal(diff.changeIndices.length, 3);
});

test("mergeParagraphChoices 按逐段选择合成最终正文", () => {
  const official = "第一段不变。\n\n第二段旧写法，节奏较慢。\n\n第三段旧结尾。";
  const candidate = "第一段不变。\n\n第二段旧写法，但节奏大幅提速。\n\n第三段新钩子结尾。";
  const diff = buildParagraphDiff(official, candidate);

  const modifiedRow = diff.rows.find((r) => r.kind === "modified");
  assert.ok(modifiedRow, "应存在改写段落");

  // 全部保留正式稿时应还原 official
  const allOfficial = Object.fromEntries(diff.changeIndices.map((idx) => [idx, "official"]));
  assert.equal(mergeParagraphChoices(diff.rows, allOfficial), official);

  // 局部采纳：保留第一处改动的正式稿，其余默认采纳候选稿
  const mixed = mergeParagraphChoices(diff.rows, { [diff.changeIndices[0]]: "official" });
  assert.ok(mixed.includes("第一段不变。"));
  assert.ok(mixed.includes("第二段旧写法，节奏较慢。"));
  assert.ok(mixed.includes("第三段新钩子结尾。"));
});

test("buildInlineDiff 生成可无损还原原文与候选稿的行内增删片段", () => {
  const official = "风灯摇晃，他推开旧木门走了进去。";
  const candidate = "风灯骤暗，他推开沉重的铁门走了进去，反手落锁。";
  const segs = buildInlineDiff(official, candidate);

  const reconstructedOfficial = segs
    .filter((s) => s.kind !== "add")
    .map((s) => s.text)
    .join("");
  const reconstructedCandidate = segs
    .filter((s) => s.kind !== "del")
    .map((s) => s.text)
    .join("");

  assert.equal(reconstructedOfficial, official);
  assert.equal(reconstructedCandidate, candidate);
  assert.ok(segs.some((s) => s.kind === "del"));
  assert.ok(segs.some((s) => s.kind === "add"));
  assert.ok(segs.some((s) => s.kind === "same"));
});

test("computeDiffStats 正确累计改动处数、新增字数与删除字数", () => {
  const official = "甲段。\n\n乙段旧文字。\n\n丙段要删除。";
  const candidate = "甲段。\n\n乙段新扩写文字。\n\n丁段新增。";
  const diff = buildParagraphDiff(official, candidate);
  const stats = computeDiffStats(diff);

  assert.equal(stats.changes, diff.changeIndices.length);
  assert.ok(stats.addedChars > 0);
  assert.ok(stats.removedChars > 0);
});
