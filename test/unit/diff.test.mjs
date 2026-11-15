import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { alignParagraphs } = await importTs("packages/fanqie/src/learning/diff.ts");

test("alignParagraphs detects delete, expand, dialogue, and preserves surrounding context", () => {
  const before = ["第一段保持不变。", "这一段会被删掉。", "第三段结尾。"].join("\n\n");
  const after = [
    "第一段保持不变。",
    "新增的动作描写段落。",
    "“这是新增的对话。”",
    "第三段结尾。",
  ].join("\n\n");

  const hunks = alignParagraphs(before, after);
  assert.equal(hunks.length, 3);
  assert.deepEqual(
    hunks.map((h) => h.kind),
    ["expand", "dialogue", "delete"],
  );
  assert.equal(hunks[0].after, "新增的动作描写段落。");
  assert.equal(hunks[1].after, "“这是新增的对话。”");
  assert.equal(hunks[2].before, "这一段会被删掉。");
  assert.deepEqual(hunks[0].context, ["第一段保持不变。", "第三段结尾。"]);
});
