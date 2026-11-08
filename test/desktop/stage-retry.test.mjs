import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  StageError,
  classifyStageError,
  stageModel,
  withProviderRetry,
} from "../../apps/desktop/out-test/stage-model.mjs";
import { defaultModels } from "../../apps/desktop/out-test/models.mjs";
import { WorkflowJournal, WorkflowBudgetError } from "../../build/core/src/workflow.js";
import { fakeModel } from "./fake-model.mjs";

test("stage errors are classified into balance, transient and content failures", () => {
  assert.equal(classifyStageError("402 Insufficient Balance"), "balance");
  assert.equal(classifyStageError("账户余额不足"), "balance");
  assert.equal(classifyStageError("429 Too Many Requests"), "transient");
  assert.equal(classifyStageError("503 Service Unavailable"), "transient");
  assert.equal(classifyStageError("fetch failed: ECONNRESET"), "transient");
  assert.equal(classifyStageError("You exceeded your current quota: billing details"), "balance");
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

const usage = (output) => ({ input: 10, output, cacheRead: 0, cacheWrite: 0, cost: null });
async function journalIn(dir) {
  return WorkflowJournal.open(path.join(dir, "w.json"), {}, "h", "b", () => {});
}

test("a typed transient failure that outlasts the backoff is final for the stage", async () => {
  let calls = 0;
  await assert.rejects(
    withProviderRetry(
      async () => {
        calls++;
        throw new StageError("503 overloaded", "transient", usage(0));
      },
      new AbortController().signal,
      [1],
    ),
    (error) => error.kind === "transient",
  );
  assert.equal(calls, 2);
  await assert.rejects(
    withProviderRetry(
      async () => {
        throw new StageError("insufficient_quota", "balance");
      },
      new AbortController().signal,
      [1],
    ),
    (error) => error.constructor.name === "WorkflowBudgetError",
  );
});

test("journal: a truncated answer is not retried and its usage is still recorded", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const journal = await journalIn(dir);
    let calls = 0;
    await assert.rejects(
      journal.step(
        "draft",
        "起稿",
        (v) => v,
        async () => {
          calls++;
          throw new StageError("阶段输出被截断", "truncated", usage(4096));
        },
        new AbortController().signal,
        2,
      ),
      /截断/,
    );
    assert.equal(calls, 1);
    assert.equal(journal.record.steps[0].usage.output, 4096);
    const disk = JSON.parse(await readFile(path.join(dir, "w.json"), "utf8"));
    assert.equal(disk.steps[0].usage.output, 4096);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journal: a content retry is told why the previous answer failed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const journal = await journalIn(dir);
    const seen = [];
    const value = await journal.step(
      "scene",
      "场景",
      (v) => {
        if (v !== "ok") throw new Error("返回缺少 scenes");
        return v;
      },
      async (attempt) => {
        seen.push(attempt);
        return { value: attempt.index ? "ok" : "bad", usage: usage(1) };
      },
      new AbortController().signal,
      1,
    );
    assert.equal(value, "ok");
    assert.deepEqual(seen, [
      { index: 0, lastError: undefined },
      { index: 1, lastError: "返回缺少 scenes" },
    ]);
    assert.equal(journal.record.steps[0].usage.output, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journal: concurrent saves leave the newest state on disk", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const journal = await journalIn(dir);
    const saves = [];
    for (let index = 0; index < 20; index++) {
      journal.record.steps.push({
        id: "s" + index,
        title: "阶段",
        status: "complete",
        started: new Date().toISOString(),
        durationMs: 0,
        attempts: 1,
        usage: usage(1),
        output: index,
      });
      saves.push(journal.save());
    }
    await Promise.all(saves);
    const disk = JSON.parse(await readFile(path.join(dir, "w.json"), "utf8"));
    assert.equal(disk.steps.length, 20);
    assert.equal(disk.updated, journal.record.updated);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("stage request: prefix as system prompt, no SDK retry, truncation keeps usage", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "stage-model-"));
  const model = await fakeModel({}, () => ({
    text: '{"title":"半',
    finish: "length",
    usage: { prompt_tokens: 50, completion_tokens: 4096 },
  }));
  try {
    await mkdir(path.join(base, "agent"), { recursive: true });
    const models = defaultModels();
    Object.assign(models.writer, {
      provider: "fixture",
      baseUrl: model.url,
      apiKey: "fixture-key",
      model: "mock-writer",
      reasoning: false,
      thinkingLevel: "off",
    });
    const host = { settings: () => models, home: base };
    await assert.rejects(
      stageModel(
        host,
        "writer",
        { prefix: "## 阶段职责\n只返回 JSON", suffix: "## 本阶段输入\n{}" },
        new AbortController().signal,
        { sessionId: "run-abc" },
      ),
      (error) =>
        error.kind === "truncated" && error.retryable === false && error.usage.output === 4096,
    );
    assert.equal(model.calls.length, 1);
    const [call] = model.calls;
    assert.match(JSON.stringify(call.messages[0]), /阶段职责/);
    assert.notEqual(call.messages[0].role, "user");
    assert.equal(call.messages.at(-1).role, "user");
    assert.match(JSON.stringify(call.messages.at(-1)), /本阶段输入/);
  } finally {
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});
