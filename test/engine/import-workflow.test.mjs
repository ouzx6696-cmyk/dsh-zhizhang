import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";
import { workspace, runPipeline } from "../support/v14.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
const importer = await importTs("packages/fanqie/src/import/index.ts"),
  { importPipeline } = await importTs("packages/fanqie/src/pipelines/import/index.ts"),
  { createModelGateway } = await importTs("packages/core/src/model/index.ts");
async function staged(t, source = "# 人物\n林川是守灯人。") {
  const env = await workspace(t),
    file = path.join(env.base, "source.md");
  await fs.writeFile(file, source);
  const store = importer.createImportStore(env.locks);
  const view = await store.stage(env.work, file);
  return { ...env, view, store, file };
}
function gateway(port, clock) {
  return createModelGateway(
    port,
    {
      globalConcurrency: 4,
      perRunConcurrency: 3,
      roles: Object.fromEntries(
        ["writer", "planner", "extractor", "judge"].map((role) => [
          role,
          { connection: "fake", model: "fake" },
        ]),
      ),
    },
    clock,
  );
}
function responder(view, fail = false) {
  return (req) => {
    if (req.user.includes("【阶段】docmap"))
      return {
        text: JSON.stringify({
          mapping: {},
          sections: view.segments.map((s) => ({ id: s.id, kind: s.kind })),
          naming: [],
          editedByAuthor: false,
        }),
      };
    if (fail) return { error: { code: "model.auth", message: "forced block failure" } };
    const raw = JSON.parse(
        req.user.slice(req.user.indexOf('{"stage":'), req.user.indexOf("\n\nJSON:")),
      ),
      para = raw.text.match(/\[(P[^\]]+)\]/u)?.[1];
    return {
      text: JSON.stringify({
        items: [
          {
            type: "entity",
            tmp: "lin",
            kind: "character",
            name: "林川",
            summary: "守灯人",
            src: [para],
            quote: "林川是守灯人。",
            confidence: 0.99,
          },
        ],
        unassigned: [],
      }),
    };
  };
}
test("导入 → 抽取提案不写真源 → 决定与提交分离 → 可撤销", async (t) => {
  const env = await staged(t),
    { work, view, clock, library } = env;
  const port = createFakeModelPort(responder(view), { repeatLast: true }),
    ctx = await importPipeline.context(
      { mode: "fanqie", path: work },
      {
        batch: view.batch,
        sections: view.segments.map((s) => s.id),
        estimate: { inputMax: 20000, outputMax: 3000 },
      },
    );
  const run = await runPipeline(importPipeline, ctx, gateway(port, clock), clock);
  assert.equal(run.state, "awaiting-author");
  assert.equal((await library.read(work)).entities.length, 0);
  const pending = await library.readPendingBatch(work, view.batch);
  assert.equal(pending.items.length, 1);
  assert.equal(pending.items[0].src[0].located, "exact");
  await library.decide(
    work,
    view.batch,
    pending.items.map((item) => ({ id: item.id, decision: "accept" })),
  );
  assert.equal((await library.read(work)).entities.length, 0);
  const index = await (await importTs("packages/fanqie/src/bible/read.ts")).readIndexOrEmpty(work);
  const commit = await library.commit(work, view.batch, index.files);
  assert.equal(commit.committed, 1);
  assert.equal((await library.read(work)).entities[0].name, "林川");
  assert.ok(
    JSON.parse(
      await fs.readFile(importer.batchPath(work, view.batch, "commits.json"), "utf8"),
    ).includes(commit.changeId),
  );
  await library.revert(work, commit.changeId);
  assert.equal((await library.read(work)).entities.length, 0);
});
test("失败块不丢已成功块 → 批次 partial；重试复用成功块缓存", async (t) => {
  const env = await staged(
    t,
    "# 人物\n林川是守灯人。\n\n# 地图\n" +
      Array.from({ length: 1200 }, (_, i) => `第${i}座东岸码头有${i}艘船。`).join("\n\n"),
  );
  const { work, view, clock } = env;
  const respond = responder(view);
  const port = createFakeModelPort(
    (req) => {
      if (req.user.includes("【阶段】extract 第 2 /"))
        return { error: { code: "model.auth", message: "failed" } };
      return respond(req);
    },
    { repeatLast: true },
  );
  const request = {
    batch: view.batch,
    sections: view.segments.map((s) => s.id),
    estimate: { inputMax: 100000, outputMax: 10000 },
  };
  await runPipeline(
    importPipeline,
    await importPipeline.context({ mode: "fanqie", path: work }, request),
    gateway(port, clock),
    clock,
  );
  const partial = await importer.readBatch(work, view.batch);
  assert.equal(partial.status, "partial");
  assert.ok(partial.failedChunks.length);
  let retried = 0;
  const retry = createFakeModelPort(
    (req) => {
      if (req.user.includes("【阶段】extract")) retried++;
      return respond(req);
    },
    { repeatLast: true },
  );
  await runPipeline(
    importPipeline,
    await importPipeline.context({ mode: "fanqie", path: work }, request),
    gateway(retry, clock),
    clock,
  );
  assert.equal(retried, partial.failedChunks.length);
  assert.equal((await importer.readBatch(work, view.batch)).failedChunks.length, 0);
});
test("同一规范化正文再次导入 → duplicateOf；只改映射与编码不调用模型", async (t) => {
  const { work, view, store, file } = await staged(t);
  const duplicate = await store.stage(work, file);
  assert.equal(duplicate.duplicateOf, view.batch);
  const updated = await store.resegment(work, view.batch, { volume: ["人物"] });
  assert.equal(updated.segments[0].kind, "outline-volume");
  assert.ok(updated.estimate.runBudget >= updated.estimate.tokens.inputMax);
});
test("导入前拒绝越界批次、非文本类型与过小输入预算", async (t) => {
  const { work, store, file, locks } = await staged(t);
  assert.throws(() => importer.batchPath(work, "../escape", "source.txt"));
  await assert.rejects(
    store.stage(work, file.replace(".md", ".exe")),
    (error) => error.data.reason === "file_type",
  );
  await assert.rejects(
    importer
      .createImportStore(locks, () => ({ inputBudget: 8000, runBudget: 1000 }))
      .stage(work, file),
    (error) => error.code === "input.invalid",
  );
});
