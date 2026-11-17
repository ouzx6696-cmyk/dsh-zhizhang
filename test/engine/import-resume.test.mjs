import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { workspace } from "../support/v14.mjs";
import { importTs } from "../support/ts-loader.mjs";
import { importBundle } from "../support/bundle.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
const importer = await importTs("packages/fanqie/src/import/index.ts"),
  desk = await importBundle("test/support/desktop-entry.ts");
test("选择失败块重试 → 沿用原 run，只请求失败块，已有作者决定与依赖保留", async (t) => {
  const env = await workspace(t),
    file = path.join(env.base, "source.md");
  await fs.writeFile(
    file,
    "# 人物\n林川是守灯人。\n\n# 地点\n" +
      Array.from({ length: 1100 }, (_, i) => `第${i}座码头有${i}条船。`).join("\n\n"),
  );
  const view = await importer.createImportStore(env.locks).stage(env.work, file);
  let retry = false,
    finish;
  const completed = new Promise((resolve) => (finish = resolve)),
    calls = [];
  const port = createFakeModelPort(
      (req) => {
        if (req.user.includes("【阶段】docmap"))
          return {
            text: JSON.stringify({
              mapping: {},
              sections: view.segments.map((s) => ({ id: s.id, kind: s.kind })),
              naming: [],
              editedByAuthor: false,
            }),
          };
        calls.push({ retry, user: req.user });
        if (!retry && req.user.includes("【阶段】extract 第 2 /"))
          return { error: new desk.AppError("model.auth", "块失败") };
        const input = JSON.parse(req.user.slice(0, req.user.indexOf("\n\nJSON:"))),
          para = input.text.match(/\[(P[^\]]+)\]/u)[1];
        return {
          text: JSON.stringify({
            items: input.text.includes("林川")
              ? [
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
                ]
              : [],
            unassigned: [],
          }),
        };
      },
      { repeatLast: true },
    ),
    gateway = desk.createModelGateway(
      port,
      {
        globalConcurrency: 4,
        perRunConcurrency: 3,
        roles: { writer: { connection: "fake", model: "fake" } },
      },
      env.clock,
    ),
    runs = desk.createRunStore(path.join(env.base, "runs")),
    workflow = desk.createWorkflowService({
      clock: env.clock,
      runs,
      gateway: () => gateway,
      budget: () => ({ inputBudget: 200000, runBudget: 10000000, moneyCap: null }),
      profileRoots: () => ({ builtinDir: path.resolve("packages/fanqie/profiles") }),
      profileId: async () => "default",
      emit: (event) => {
        if (retry && event.kind === "run" && event.run.state === "awaiting-author") finish();
      },
    });
  t.after(() => workflow.stopAll());
  const target = { mode: "fanqie", path: env.work },
    record = await workflow.startAndWait(target, "fanqie.import", {
      batch: view.batch,
      sections: view.segments.map((s) => s.id),
      estimate: { inputMax: 100000, outputMax: 10000 },
    }),
    partial = await importer.readBatch(env.work, view.batch);
  assert.equal(partial.status, "partial");
  const before = await env.library.readPendingBatch(env.work, view.batch);
  await env.library.decide(
    env.work,
    view.batch,
    before.items.map((item) => ({ id: item.id, decision: "reject" })),
  );
  retry = true;
  const ref = await workflow.retryImport({ target, runId: record.id }, partial.failedChunks);
  await completed;
  assert.equal(ref.runId, record.id);
  assert.equal((await workflow.history(target)).length, 1);
  assert.equal(calls.filter((call) => call.retry).length, partial.failedChunks.length);
  assert.ok(
    calls
      .filter((call) => call.retry)
      .every((call) => call.user.includes("【阶段】extract 第 2 /")),
  );
  const after = await env.library.readPendingBatch(env.work, view.batch);
  assert.equal(after.items[0].id, before.items[0].id);
  assert.equal(after.items[0].decision, "reject");
  assert.equal((await importer.readBatch(env.work, view.batch)).status, "reviewing");
});
