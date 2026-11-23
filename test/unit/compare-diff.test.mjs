import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { buildParagraphDiff, mergeParagraphChoices } = await importTs(
  "apps/desktop/src/renderer/features/workflow/compare-diff.ts",
);

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
