import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { classifyStageError, withProviderRetry } from "../../apps/desktop/out-test/stage-model.mjs";
import { WorkflowJournal, WorkflowBudgetError } from "../../build/core/src/workflow.js";

test("stage errors are classified into balance, transient and content failures", () => {
  assert.equal(classifyStageError("402 Insufficient Balance"), "balance");
  assert.equal(classifyStageError("账户余额不足"), "balance");
  assert.equal(classifyStageError("429 Too Many Requests"), "transient");
  assert.equal(classifyStageError("503 Service Unavailable"), "transient");
  assert.equal(classifyStageError("fetch failed: ECONNRESET"), "transient");
  assert.equal(classifyStageError("模型返回格式不合法"), "other");
});

test("transient provider failures back off and retry before succeeding", async () => {
  let calls = 0;
  const value = await withProviderRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("429 rate limit reached");
      return "ok";
    },
    new AbortController().signal,
    [1, 1, 1],
  );
  assert.equal(value, "ok");
  assert.equal(calls, 3);
});

test("transient retries stop after the backoff schedule and content errors are not retried", async () => {
  let calls = 0;
  await assert.rejects(
    withProviderRetry(
      async () => {
        calls++;
        throw new Error("502 Bad Gateway");
      },
      new AbortController().signal,
      [1, 1],
    ),
    /502/,
  );
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(
    withProviderRetry(
      async () => {
        calls++;
        throw new Error("返回缺少 title");
      },
      new AbortController().signal,
      [1, 1],
    ),
    /title/,
  );
  assert.equal(calls, 1);
});

test("an out-of-credit answer becomes a resumable budget pause", async () => {
  await assert.rejects(
    withProviderRetry(
      async () => {
        throw new Error("402 Insufficient Balance");
      },
      new AbortController().signal,
      [1],
    ),
    // The test bundle inlines its own copy of the class, so match by name rather than identity.
    (error) => error.constructor.name === "WorkflowBudgetError" && /余额不足/.test(error.message),
  );
});

test("abort during backoff stops waiting immediately", async () => {
  const controller = new AbortController();
  const pending = withProviderRetry(
    async () => {
      throw new Error("503 overloaded");
    },
    controller.signal,
    [60000],
  );
  setTimeout(() => controller.abort(new Error("stopped")), 5);
  await assert.rejects(pending, /stopped/);
});

test("the journal does not spend a second attempt on a budget pause", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const journal = await WorkflowJournal.open(path.join(dir, "w.json"), {}, "h", "b", () => {});
    let calls = 0;
    await assert.rejects(
      journal.step(
        "s",
        "阶段",
        (v) => v,
        async () => {
          calls++;
          throw new WorkflowBudgetError("余额不足");
        },
        new AbortController().signal,
        2,
      ),
      WorkflowBudgetError,
    );
    assert.equal(calls, 1);
    assert.equal(journal.record.steps[0].status, "failed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
