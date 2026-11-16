import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { executePipeline, emptyUsage } = await importTs("packages/core/src/pipeline/index.ts");
const { createModelGateway } = await importTs("packages/core/src/model/index.ts");

test("fanOut 并行步骤在首笔落盘挂起期间 → 其余写盘串行等待，不得并发进入 onPersist", async () => {
  // 回归：并行步骤各写同一份运行记录时，Windows 上并发重命名会瞬时 EPERM，
  // 被归类为 storage.locked 而误停整条运行。修复方式是 runner 内把 persist 串成队列；
  // 本测试用挂起的首笔写盘制造最长重叠窗口，断言其余写盘不会并发进入。
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-runner-persist-"));
  const port = createFakeModelPort([{ text: "候选一" }, { text: "候选二" }]);
  const clock = createFakeClock();
  const gateway = createModelGateway(
    port,
    {
      globalConcurrency: 2,
      perRunConcurrency: 2,
      roles: { writer: { connection: "mock", model: "mock-writer" } },
    },
    clock,
  );

  let active = 0;
  let maxActive = 0;
  const holds = [];
  const onPersist = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => holds.push(resolve));
    active -= 1;
  };

  const def = {
    kind: "fanqie.chapter",
    async run(runner) {
      return await runner.fanOut(
        {
          id: "draft",
          title: "起稿",
          role: "writer",
          input: () => "本章任务",
          shape: "纯文本输出：首行 `# 章名`。",
          format: "text",
          parse: (raw) => raw.trim(),
          fanOut: { count: () => 2 },
        },
        { prefix: [], suffix: [], omitted: [], estimate: 0 },
      );
    },
    async deliver(res) {
      return { runId: "run-1", deliveredPaths: [], contentHash: "h", summary: res.join("|") };
    },
  };

  const record = {
    id: "run-1",
    kind: "fanqie.chapter",
    target: { mode: "fanqie", path: dir },
    state: "running",
    stateHistory: [],
    steps: [],
    budget: { inputBudget: 8000, runBudget: 20000, moneyCap: null },
    usage: emptyUsage(),
    created: clock.iso(),
    updated: clock.iso(),
  };

  const outcome = executePipeline(
    def,
    record,
    { runId: "run-1", target: record.target, request: {}, state: {} },
    gateway,
    clock,
    new AbortController().signal,
    onPersist,
  ).then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, error }),
  );
  let settled = false;
  void outcome.then(() => {
    settled = true;
  });

  try {
    // 等首笔落盘进入 onPersist 并挂起；两笔模型调用都已发生。
    for (let i = 0; i < 100 && holds.length === 0; i++) await clock.sleep(1);
    for (let i = 0; i < 100 && port.calls.length < 2; i++) await clock.sleep(1);
    // 多转几拍，给第二笔到达 persist 调用点的机会（若未串行化会并发进入）。
    for (let i = 0; i < 20; i++) await clock.sleep(1);
    assert.equal(maxActive, 1, "并行步骤的落盘不得重叠进入 onPersist");

    // 每轮放行当前挂起的写盘再转一拍，直到流水线收尾（串行队列下每轮至少推进一笔）。
    for (let i = 0; i < 100 && !settled; i++) {
      for (const release of holds.splice(0)) release();
      await clock.sleep(1);
    }
    assert.ok(settled, "流水线未在限定轮次内收尾");
  } finally {
    for (const release of holds.splice(0)) release();
  }

  const result = await outcome;
  assert.ok(result.ok, `流水线不应失败：${result.ok ? "" : result.error?.message}`);
  assert.equal(result.value.state, "awaiting-author");
  assert.equal(maxActive, 1);
  assert.deepEqual(
    result.value.steps.filter((s) => s.id.startsWith("draft")).map((s) => s.status),
    ["done", "done"],
  );
});
