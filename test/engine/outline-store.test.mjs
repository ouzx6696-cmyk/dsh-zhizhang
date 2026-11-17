import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { workspace, treeOps, chapter, provenance } from "../support/v14.mjs";

test("三卷、每卷两幕、每幕三章纲 → 位置连续 1..18，未绑定正文排末尾", async (t) => {
  const { work, store, locks } = await workspace(t),
    { ops, ids } = treeOps();
  await store.apply(work, ops, 0);
  const view = await store.get(work);
  assert.deepEqual(
    view.nodes.filter((node) => node.level === "chapter").map((node) => node.position),
    Array.from({ length: 18 }, (_, i) => i + 1),
  );
  await chapter.saveChapter(work, { chapterId: "z-last", body: "Z" }, locks);
  await chapter.saveChapter(work, { chapterId: "a-first", body: "A" }, locks);
  assert.deepEqual(
    (await chapter.listChapters(work)).map((row) => [row.id, row.position]),
    [
      ["a-first", 19],
      ["z-last", 20],
    ],
  );
  assert.equal((await store.get(work)).unplaced.length, 2);
  assert.equal(ids.length, 18);
  await assert.rejects(fs.access(path.join(work, "plan", "structure.json")));
});
test("同一正文绑定两章纲 → input.invalid V2-3；旧 rev 不可写入", async (t) => {
  const { work, store } = await workspace(t),
    { ops, ids } = treeOps(1, 1, 2);
  const first = await store.apply(work, ops, 0);
  await assert.rejects(
    store.apply(
      work,
      [
        { type: "chapter.bind", plan: ids[0], chapterId: "same" },
        { type: "chapter.bind", plan: ids[1], chapterId: "same" },
      ],
      first.rev,
    ),
    (error) => error.code === "input.invalid" && error.data.rule === "V2-3",
  );
  await assert.rejects(store.apply(work, [], 0), (error) => error.code === "storage.conflict");
});
test("卷顺序与文件不一致 → format_unsupported，坏文件不被覆盖", async (t) => {
  const { work, store } = await workspace(t),
    { ops } = treeOps(1, 1, 1);
  await store.apply(work, ops, 0);
  const file = path.join(work, "outline", "volumes", "unexpected.json");
  await fs.writeFile(file, "broken");
  await assert.rejects(store.get(work), (error) => error.code === "storage.format_unsupported");
  assert.equal(await fs.readFile(file, "utf8"), "broken");
});
test("移动已写章 → 必须先预览；陈旧 token 拒绝；确认后正文绑定与位置同步", async (t) => {
  const { work, store, locks } = await workspace(t),
    { ops, ids } = treeOps(1, 1, 2);
  await store.apply(work, ops, 0);
  const created = await store.createFromPlan(work, ids[0]);
  await chapter.saveChapter(
    work,
    { chapterId: created.chapterId, body: "正文", status: "drafted" },
    locks,
  );
  const view = await store.get(work),
    parent = view.nodes.find((node) => node.id === ids[0]).parent;
  const move = [{ type: "node.move", ids: [ids[0]], parent, index: 1 }];
  await assert.rejects(
    store.apply(work, move, view.rev),
    (error) => error.data.reason === "remap_required",
  );
  const preview = await store.preview(work, move);
  assert.equal(preview.moves.length, 1);
  await store.apply(
    work,
    [{ type: "book.update", patch: { title: "新书名" }, expectedRev: view.book.rev }],
    view.rev,
  );
  await assert.rejects(
    store.apply(work, move, undefined, preview.token),
    (error) => error.data.reason === "preview_stale",
  );
  const fresh = await store.preview(work, move);
  await store.apply(work, move, undefined, fresh.token);
  assert.equal((await chapter.readChapter(work, created.chapterId)).meta.outlineId, ids[0]);
  assert.equal((await chapter.listChapters(work))[0].position, 2);
});
test("大纲变更撤销与撤销的撤销 → 卷文件、书目录同时恢复", async (t) => {
  const { work, store, library } = await workspace(t),
    { ops } = treeOps(1, 1, 1),
    before = await fs.readFile(path.join(work, "outline", "book.json"), "utf8");
  const change = await store.apply(work, ops, 0);
  const undo = await library.revert(work, change.changeId);
  assert.equal(undo.skipped.length, 0);
  assert.equal(await fs.readFile(path.join(work, "outline", "book.json"), "utf8"), before);
  assert.equal((await store.get(work)).nodes.length, 0);
  await library.revert(work, undo.changeIds[0]);
  assert.equal((await store.get(work)).nodes.length, 3);
});
test("大纲后来被修改 → 原变更撤销跳过整个大纲组，目录不失配", async (t) => {
  const { work, store, library } = await workspace(t),
    { ops, ids } = treeOps(1, 1, 1),
    created = await store.apply(work, ops, 0);
  const view = await store.get(work),
    node = view.nodes.find((node) => node.id === ids[0]);
  await store.apply(
    work,
    [{ type: "node.update", id: node.id, expectedRev: node.rev, patch: { title: "作者修改" } }],
    view.rev,
  );
  const undone = await library.revert(work, created.changeId);
  assert.ok(undone.skipped.length);
  assert.equal((await store.get(work)).nodes.find((row) => row.id === node.id)?.title, "作者修改");
});

test("大纲视图汇总章节目标、定稿进度和一致性发现", async (t) => {
  const { work, store, locks } = await workspace(t),
    { ops, ids } = treeOps(1, 1, 2);
  for (const op of ops) {
    if (op.type !== "node.create") continue;
    if (op.level === "chapter") op.node.wordTarget = 1000;
    else op.node.wordTarget = 2000;
  }
  await store.apply(work, ops, 0);
  const first = await store.createFromPlan(work, ids[0]);
  await chapter.saveChapter(
    work,
    { chapterId: first.chapterId, body: "林川", status: "drafted" },
    locks,
  );
  await chapter.reviewChapter(work, { chapterId: first.chapterId }, locks);
  await chapter.finalizeChapter(work, { chapterId: first.chapterId }, locks);
  const view = await store.get(work),
    volume = view.nodes.find((node) => node.level === "volume"),
    act = view.nodes.find((node) => node.level === "act"),
    plan = view.nodes.find((node) => node.id === ids[0]);
  assert.equal(volume.wordTargetRollup, 2000);
  assert.equal(act.wordTargetRollup, 2000);
  assert.deepEqual(volume.progress, { final: 1, total: 2 });
  assert.deepEqual(plan.progress, { final: 1, total: 1 });
  assert.equal(plan.findings, 1);
  assert.equal(volume.findings, 1);
});

test("混合大纲与设定写入后其中一份文件变化，撤销跳过整个事务", async (t) => {
  const { work, store, library } = await workspace(t),
    { ops } = treeOps(1, 1, 1),
    entitiesFile = path.join(work, "bible", "entities.json"),
    before = await fs.readFile(entitiesFile, "utf8").catch(() => null),
    first = {
      id: "ent-undo-check",
      kind: "character",
      name: "沈砚",
      aliases: [],
      summary: "守夜人",
      locked: [],
      provenance,
      rev: 0,
    };
  const result = await store.apply(work, ops, 0, undefined, [
    {
      path: entitiesFile,
      beforeHash: before === null ? null : createHash("sha256").update(before).digest("hex"),
      after: JSON.stringify([first], null, 2),
    },
  ]);
  await fs.writeFile(
    entitiesFile,
    JSON.stringify([first, { ...first, id: "ent-later-edit", name: "后来新增" }], null, 2),
  );
  const undone = await library.revert(work, result.changeId);
  assert.deepEqual(undone.changeIds, []);
  assert.ok(undone.skipped.some((item) => item.target === "bible/entities.json"));
  assert.equal((await store.get(work)).nodes.length, 3);
  assert.match(await fs.readFile(entitiesFile, "utf8"), /ent-later-edit/u);
});
