import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";
import { chapter, provenance, treeOps, workspace } from "../support/v14.mjs";

const { PendingBatchSchema } = await importTs("packages/fanqie/src/bible/ops-schema.ts"),
  { pendingFilePath, readIndexOrEmpty } = await importTs("packages/fanqie/src/bible/read.ts");

test("混合待确认批次移动已写章 → 缺少预览令牌拒绝，确认后同一事务重映射台账", async (t) => {
  const env = await workspace(t),
    { work, store, library, locks } = env,
    { ops, ids } = treeOps(1, 1, 2),
    actId = "act-00000002";
  for (const id of ids) {
    const bodyId = id === ids[0] ? "ch-first" : "ch-second";
    const create = ops.find((op) => op.type === "node.create" && op.node.id === id);
    create.node.chapterId = bodyId;
    await chapter.saveChapter(
      work,
      { chapterId: bodyId, body: `第${id.slice(-1)}章正文。`, status: "drafted" },
      locks,
    );
  }
  await store.apply(work, ops, 0);
  await library.apply(
    work,
    [
      {
        type: "entity.upsert",
        entity: {
          id: "ent-ward",
          kind: "character",
          name: "林川",
          aliases: [],
          summary: "守灯人",
          locked: [],
          provenance,
          rev: 0,
        },
      },
    ],
    1,
  );
  const batch = PendingBatchSchema({
    format: "zhizhang/1.3",
    id: "pln-mixed-remap",
    source: "plan",
    created: "2026-11-17T00:00:00.000Z",
    status: "open",
    items: [
      {
        id: "p-move",
        op: { type: "node.move", ids: [ids[0]], parent: actId, index: 1 },
        change: "update",
        group: "outline",
        dependsOn: [],
        notes: [],
        decision: "accept",
      },
      {
        id: "p-state",
        op: {
          type: "state.add",
          entry: {
            id: "st-new-position",
            entity: "ent-ward",
            facet: "location",
            field: "所在",
            value: "旧渡口",
            since: 2,
            mode: "replace",
            status: "confirmed",
            provenance,
            rev: 0,
          },
        },
        change: "new",
        group: "bible",
        dependsOn: [],
        notes: [],
        decision: "accept",
      },
    ],
    commits: [],
  });
  await fs.writeFile(pendingFilePath(work, batch.id), JSON.stringify(batch, null, 2));
  const index = await readIndexOrEmpty(work);
  await assert.rejects(
    library.commit(work, batch.id, index.files),
    (error) => error.code === "input.invalid" && error.data.reason === "remap_required",
  );
  const preview = await store.preview(work, [
    { type: "node.move", ids: [ids[0]], parent: actId, index: 1 },
  ]);
  const committed = await library.commit(work, batch.id, index.files, preview.token);
  assert.equal(committed.committed, 2);
  assert.equal((await chapter.listChapters(work))[0].id, "ch-second");
  assert.equal((await library.read(work)).states[0].since, 1);
  const undone = await library.revert(work, committed.changeId);
  assert.equal(undone.skipped.length, 0);
  assert.equal((await chapter.listChapters(work))[0].id, "ch-first");
  assert.equal((await library.read(work)).states.length, 0);
});
