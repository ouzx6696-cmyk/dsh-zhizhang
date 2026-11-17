import assert from "node:assert/strict";
import test from "node:test";
import { core, runPipeline } from "../support/v14.mjs";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";
const { AppError } = await importTs("packages/core/src/errors/index.ts");
const packet = { prefix: [], suffix: [], omitted: [], estimate: 0 };
for (const pause of [false, true])
  test(`并行块 ${pause ? "预算暂停" : "普通失败"} → ${pause ? "整体暂停" : "保留其余结果"}`, async () => {
    const clock = createFakeClock(),
      ctx = { runId: "parallel", target: { mode: "test", path: "/tmp" }, request: {}, state: {} };
    let result;
    const definition = {
      kind: "test.parallel",
      async run(runner) {
        result = await runner.fanOutSettled(
          {
            id: "extract",
            title: "extract",
            role: "writer",
            input: (_ctx, index) => String(index),
            shape: "",
            format: "text",
            parse: (raw) => raw,
            fanOut: { count: () => 3 },
          },
          packet,
        );
        return result;
      },
      async deliver() {},
    };
    const gateway = {
      async run(_role, req) {
        if (req.user === "1") throw new AppError(pause ? "budget.tokens" : "model.auth", "failure");
        return { text: req.user, usage: { input: 1, cachedInput: 0, output: 1 }, cost: 0 };
      },
    };
    const record = await runPipeline(definition, ctx, gateway, clock);
    assert.equal(record.state, pause ? "paused" : "awaiting-author");
    if (!pause) {
      assert.equal(result[0].value, "0");
      assert.equal(result[1].ok, false);
      assert.equal(result[1].error.code, "model.auth");
      assert.equal(result[2].value, "2");
    }
  });
test("模型阶段 context 摘要 → 不包含正文并随已完成步骤持久化", async () => {
  const clock = createFakeClock(),
    ctx = { runId: "context", target: { mode: "test", path: "/tmp" }, request: {}, state: {} };
  const block = {
    id: "secret-text",
    layer: 2,
    text: "正文不可写进摘要",
    tokens: 10,
    required: true,
    reason: "in-scope",
    source: { kind: "bible", ref: "entities" },
  };
  const def = {
    kind: "test.context",
    async run(runner) {
      return runner.stage(
        {
          id: "model",
          title: "model",
          role: "writer",
          input: () => "task",
          shape: "",
          format: "text",
          parse: (raw) => raw,
        },
        { ...packet, prefix: [block] },
      );
    },
    async deliver() {},
  };
  const record = await runPipeline(
    def,
    ctx,
    {
      async run() {
        return { text: "ok", usage: core.emptyUsage(), cost: 0 };
      },
    },
    clock,
  );
  assert.equal(record.steps[0].context[0].id, block.id);
  assert.equal("text" in record.steps[0].context[0], false);
});
