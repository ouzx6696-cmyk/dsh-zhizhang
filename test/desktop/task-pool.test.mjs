import test from "node:test";
import assert from "node:assert/strict";
import { runTaskPool } from "../../apps/desktop/out-test/task-pool.mjs";

test("DK-11 暂停后不派发剩余任务，已启动的任务仍结算", async () => {
  const pause = new Error("budget pause"),
    started = [],
    settled = [];
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const pending = runTaskPool(
    10,
    2,
    async (index) => {
      started.push(index);
      if (index === 0) {
        await Promise.resolve();
        throw pause;
      }
      await waiting;
      settled.push(index);
      return index;
    },
    { stopOn: (error) => error === pause },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, [0, 1]);
  release();
  await assert.rejects(pending, (error) => error === pause);
  assert.deepEqual(settled, [1]);
  assert.deepEqual(started, [0, 1]);
});
test("DK-11 普通单路失败保持原有隔离，结果没有空洞", async () => {
  const result = await runTaskPool(
    5,
    2,
    async (index) => {
      if (index === 1) throw new Error("ordinary");
      return index;
    },
    { stopOn: () => false },
  );
  assert.equal(result.length, 5);
  assert.equal(result[1].status, "failed");
  assert.equal(result[4].value, 4);
});
