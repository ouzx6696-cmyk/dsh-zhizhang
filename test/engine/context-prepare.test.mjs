import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";
import { chapter, treeOps, workspace } from "../support/v14.mjs";

const { prepareChapter } = await importTs("packages/fanqie/src/pipelines/chapter/prepare.ts");

test("起稿上下文剔除章纲作者私记", async (t) => {
  const env = await workspace(t),
    { work, store, locks } = env,
    { ops, ids } = treeOps(1, 1, 1);
  const chapterOp = ops.find((op) => op.type === "node.create" && op.level === "chapter");
  chapterOp.node.summary = "林川在旧渡口寻找铜哨";
  chapterOp.node.notes = "作者私记：真凶是主编安插的人，不得让模型看到";
  await store.apply(work, ops, 0);
  const created = await store.createFromPlan(work, ids[0]);
  await chapter.saveChapter(work, { chapterId: created.chapterId, body: "林川守着灯。" }, locks);
  const result = await prepareChapter(
    { target: { mode: "fanqie", path: work }, state: {} },
    { chapterId: created.chapterId },
    env.library,
  );
  const text = [...result.packet.prefix, ...result.packet.suffix]
    .map((block) => block.text)
    .join("\n");
  assert.match(result.outlineText, /林川在旧渡口寻找铜哨/u);
  assert.doesNotMatch(result.outlineText, /作者私记/u);
  assert.doesNotMatch(text, /作者私记/u);
});
