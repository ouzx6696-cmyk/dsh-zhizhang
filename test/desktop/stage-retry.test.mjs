import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  StageError,
  classifyStageError,
  stageModel,
  withProviderRetry,
} from "../../apps/desktop/out-test/stage-model.mjs";
import { defaultModels } from "../../apps/desktop/out-test/models.mjs";
import { WorkflowJournal, WorkflowPause } from "../../build/core/src/workflow.js";
import { fakeModel } from "./fake-model.mjs";

const usage = (output) => ({ input: 10, output, cacheRead: 0, cacheWrite: 0, cost: null });
const REQUEST = {
  kind: "chapter",
  chapter: "c001",
  instruction: "写第一章",
  grade: "standard",
  source: "",
  line: "news",
};

// DK-01: the corrected order is out-of-credit wording → leading status → pi-ai fallback.
const PROVIDER_ERRORS = [
  ["400 Invalid request: max_tokens must be less than or equal to 500", "provider"],
  ["401 Incorrect API key provided. See https://x/account/billing for details", "auth"],
  ["403 Your account billing_status is inactive", "auth"],
  ["402 Insufficient Balance", "balance"],
  [
    "429 You exceeded your current quota, please check your plan and billing details. (insufficient_quota)",
    "balance",
  ],
  [
    "400 Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.",
    "balance",
  ],
  ["400 Arrearage: Access denied, please make sure your account is in good standing.", "balance"],
  ["429 Rate limit reached for requests", "transient"],
  ["503 Service Unavailable", "transient"],
  ["404 model not found: deepseek-reasoner-500", "provider"],
  ["Request timed out.", "transient"],
  ["Connection error.", "transient"],
  ["terminated", "transient"],
  [
    "400 This model's maximum context length is 65536 tokens. However, you requested 70000 tokens.",
    "context",
  ],
];

test("provider errors: the 13 reference messages and the overflow case land in their class", () => {
  for (const [message, kind] of PROVIDER_ERRORS)
    assert.equal(classifyStageError(message), kind, message);
});

test("provider errors: earlier classification answers still hold", () => {
  assert.equal(classifyStageError("402 Insufficient Balance"), "balance");
  assert.equal(classifyStageError("账户余额不足"), "balance");
  assert.equal(classifyStageError("429 Too Many Requests"), "transient");
  assert.equal(classifyStageError("503 Service Unavailable"), "transient");
  assert.equal(classifyStageError("fetch failed: ECONNRESET"), "transient");
  assert.equal(classifyStageError("You exceeded your current quota: billing details"), "balance");
  // Unknown text is a provider failure (fails the run), never a pause.
  assert.equal(classifyStageError("模型返回格式不合法"), "provider");
});

// RC-03 (D03): per-window quota and throttling are rate limits, not an empty wallet; a bare 402
// inside the text is not a status.
const RATE_LIMIT_ERRORS = [
  [
    "429 RESOURCE_EXHAUSTED: Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 15, model: gemini-2.5-flash. Please retry in 21s.",
    "transient",
  ],
  ["429 Quota exceeded for quota metric 'Generate Content API requests per minute'", "transient"],
  ["429 Throttling.RateQuota: Requests rate limit exceeded, please try again later.", "transient"],
  [
    "429 Throttling.AllocationQuota: Allocated quota exceeded, please increase your quota limit.",
    "transient",
  ],
  ["400 max_tokens 402 exceeds model-402 limit", "provider"],
  ["400 Arrearage: Access denied, please make sure your account is in good standing.", "balance"],
  [
    "429 You exceeded your current quota, please check your plan and billing details. (insufficient_quota)",
    "balance",
  ],
  ["402 Payment Required", "balance"],
  ["Quota exceeded for this account", "balance"],
];

test("RC-03 provider errors: rate-limit quota wording is transient, unanchored 402 is not balance", () => {
  for (const [message, kind] of RATE_LIMIT_ERRORS)
    assert.equal(classifyStageError(message), kind, message);
});

test("a parameter error that mentions 500 is sent once and fails as a provider error", async () => {
  for (const message of [
    "400 Invalid request: max_tokens must be less than or equal to 500",
    "404 model not found: deepseek-reasoner-500",
  ]) {
    let calls = 0;
    await assert.rejects(
      withProviderRetry(
        async () => {
          calls++;
          throw new Error(message);
        },
        new AbortController().signal,
        [1, 1, 1],
      ),
      (error) => error.kind === "provider" && error.message === message,
    );
    assert.equal(calls, 1, message);
  }
});

test("an invalid key with a billing link fails as auth instead of pausing for balance", async () => {
  await assert.rejects(
    withProviderRetry(
      async () => {
        throw new Error(PROVIDER_ERRORS[1][0]);
      },
      new AbortController().signal,
      [1],
    ),
    (error) => error.kind === "auth" && /鉴权或权限失败/.test(error.message),
  );
});

test("context overflow becomes a resumable pause with its own reason", async () => {
  await assert.rejects(
    withProviderRetry(
      async () => {
        throw new Error(PROVIDER_ERRORS.at(-1)[0]);
      },
      new AbortController().signal,
      [1],
    ),
    (error) => error.constructor.name === "WorkflowPause" && error.reason === "context",
  );
});

test("transient provider failures back off and retry before succeeding", async () => {
  let calls = 0;
  const value = await withProviderRetry(
    async () => {
      calls++;
      if (calls < 3) throw new Error("429 rate limit reached");
      return { value: "ok", usage: usage(1) };
    },
    new AbortController().signal,
    [1, 1, 1],
  );
  assert.equal(value.value, "ok");
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
    (error) =>
      error.constructor.name === "WorkflowPause" &&
      error.reason === "balance" &&
      /余额不足/.test(error.message),
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
  await assert.rejects(
    pending,
    (error) => error.kind === "aborted" && error.cause.message === "stopped",
  );
});

test("the journal does not spend a second attempt on a budget pause", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const journal = await WorkflowJournal.open(
      path.join(dir, "w.json"),
      REQUEST,
      "h",
      "b",
      () => {},
    );
    let calls = 0;
    await assert.rejects(
      journal.step(
        "s",
        "阶段",
        { parse: (v) => v },
        async () => {
          calls++;
          throw new WorkflowPause("balance", "余额不足");
        },
        new AbortController().signal,
        2,
      ),
      WorkflowPause,
    );
    assert.equal(calls, 1);
    assert.equal(journal.record.steps[0].status, "failed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function journalIn(dir) {
  return WorkflowJournal.open(path.join(dir, "w.json"), REQUEST, "h", "b", () => {});
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
    (error) => error.constructor.name === "WorkflowPause" && error.reason === "balance",
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
        { parse: (v) => v },
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
      {
        parse: (v) => {
          if (v !== "ok") throw new Error("返回缺少 scenes");
          return v;
        },
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

async function stageHost(base, url) {
  await mkdir(path.join(base, "agent"), { recursive: true });
  const models = defaultModels();
  Object.assign(models.writer, {
    provider: "fixture",
    baseUrl: url,
    apiKey: "fixture-key",
    model: "mock-writer",
    reasoning: false,
    thinkingLevel: "off",
  });
  return { settings: () => models, home: base };
}
const PACKET = { prefix: "## 阶段职责\n只返回 JSON", suffix: "## 本阶段输入\n{}" };

test("stage request: a 401 with a billing link is classified once, as auth, on the production path", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "stage-model-"));
  const model = await fakeModel({}, () => ({
    status: 401,
    error: "Incorrect API key provided. See https://x/account/billing for details",
  }));
  try {
    const host = await stageHost(base, model.url);
    let seen;
    await assert.rejects(
      stageModel(host, "writer", PACKET, new AbortController().signal),
      (error) => {
        seen = error;
        return error.kind === "auth";
      },
    );
    assert.equal(model.calls.length, 1, "auth failures are not retried");
    assert.equal(classifyStageError(seen.cause.message), "auth");
  } finally {
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

function workflowRecord(fields) {
  return {
    schema: 1,
    id: "run-1",
    request: REQUEST,
    sourceHash: "h",
    created: "2026-11-01T00:00:00.000Z",
    updated: "2026-11-01T00:00:00.000Z",
    steps: [],
    basis: "b",
    ...fields,
  };
}

test("journal boundary: structured stop reason is validated", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const file = path.join(dir, "run-1.json");
    await writeFile(file, JSON.stringify(workflowRecord({ state: "paused", reason: "balance" })));
    assert.equal((await WorkflowJournal.read(file)).reason, "balance");
    await writeFile(file, JSON.stringify(workflowRecord({ state: "paused", reason: "later" })));
    await assert.rejects(WorkflowJournal.read(file), /停止原因损坏/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journal: a stage completed before a pause is not rejected on resume by a check that depends on the world now", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const taken = new Set();
    let accepts = 0,
      runs = 0;
    const check = {
      parse: (value) => ({ titles: value.titles.map((title) => title.trim()) }),
      accept: (value) => {
        accepts++;
        const fresh = value.titles.filter((title) => !taken.has(title));
        if (fresh.length < 2) throw new Error("标题矩阵需要至少2个不同标题");
        return { titles: fresh };
      },
    };
    const execute = async () => {
      runs++;
      return { value: { titles: [" 甲 ", "乙", "丙"] }, usage: usage(1) };
    };
    const first = await journalIn(dir);
    const value = await first.step(
      "headlines",
      "标题",
      check,
      execute,
      new AbortController().signal,
    );
    assert.deepEqual(value, { titles: ["甲", "乙", "丙"] });
    assert.equal(accepts, 1);
    // While paused, other work took two of the titles: accepting again would now fail.
    taken.add("甲").add("乙");
    assert.throws(() => check.accept(value), /至少2个/);
    accepts = 0;
    const reopened = await journalIn(dir);
    const resumed = await reopened.step(
      "headlines",
      "标题",
      check,
      execute,
      new AbortController().signal,
    );
    assert.deepEqual(resumed, { titles: ["甲", "乙", "丙"] }, "恢复直接返回已存输出");
    assert.equal(accepts, 0, "恢复不重跑接受校验");
    assert.equal(runs, 1, "已完成阶段不再执行");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journal: when saving a failed stage also fails, the stage error stays first", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  const dir = path.join(base, "journal");
  try {
    await mkdir(dir);
    const journal = await journalIn(dir);
    await assert.rejects(
      journal.step(
        "s",
        "阶段",
        { parse: (v) => v },
        async () => {
          // The journal directory turns into a file, so the failure save cannot be written.
          await rm(dir, { recursive: true, force: true });
          await writeFile(dir, "");
          throw new StageError("400 bad request", "provider");
        },
        new AbortController().signal,
        1,
      ),
      (error) =>
        error instanceof AggregateError &&
        error.errors[0].kind === "provider" &&
        error.message === "400 bad request" &&
        typeof error.errors[1].code === "string",
    );
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test("billed usage: failed attempts add to the answer, or travel on the error that ends the stage", async () => {
  let calls = 0;
  const answer = await withProviderRetry(
    async () => {
      calls++;
      if (calls < 3) throw new StageError("503 overloaded", "transient", usage(7));
      return { value: "ok", usage: usage(5) };
    },
    new AbortController().signal,
    [1, 1, 1],
  );
  assert.deepEqual(answer.usage, {
    input: 30,
    output: 19,
    cacheRead: 0,
    cacheWrite: 0,
    cost: null,
  });
  calls = 0;
  await assert.rejects(
    withProviderRetry(
      async () => {
        calls++;
        if (calls < 2) throw new StageError("503 overloaded", "transient", usage(7));
        throw new StageError("402 Insufficient Balance", "balance", usage(1));
      },
      new AbortController().signal,
      [1, 1, 1],
    ),
    (error) =>
      error.constructor.name === "WorkflowPause" &&
      error.reason === "balance" &&
      error.usage.output === 8,
  );
});

test("an SDK request timeout is retried once, like a stalled stream, not three times", async () => {
  let calls = 0;
  await assert.rejects(
    withProviderRetry(
      async () => {
        calls++;
        throw new Error("Request timed out.");
      },
      new AbortController().signal,
      [1, 1, 1],
    ),
    (error) => error.kind === "transient",
  );
  assert.equal(calls, 2);
});

test("journal: a stage that succeeds after two billed 503s records all three calls", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const journal = await journalIn(dir);
    let calls = 0;
    await journal.step(
      "s",
      "阶段",
      { parse: (v) => v },
      () =>
        withProviderRetry(
          async () => {
            calls++;
            if (calls < 3) throw new StageError("503 overloaded", "transient", usage(7));
            return { value: "ok", usage: usage(5) };
          },
          new AbortController().signal,
          [1, 1],
        ),
      new AbortController().signal,
    );
    assert.equal(journal.record.steps[0].usage.input, 30);
    assert.equal(journal.record.steps[0].usage.output, 19);
    assert.equal(journal.record.steps[0].attempts, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journal: a missing model connection fails once instead of earning a content retry", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "stage-model-"));
  try {
    const host = await stageHost(base, "http://127.0.0.1:9/v1");
    host.settings().writer.apiKey = "";
    const journal = await journalIn(base);
    await assert.rejects(
      journal.step(
        "s",
        "阶段",
        { parse: (v) => v },
        () => stageModel(host, "writer", PACKET, new AbortController().signal),
        new AbortController().signal,
        1,
      ),
      (error) => error.kind === "provider" && /请先配置阶段模型连接/.test(error.message),
    );
    assert.equal(journal.record.steps[0].attempts, 1);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

/** Waits on real time, which the mocked setTimeout does not drive. */
const realPause = (ms = 2) =>
  new Promise((resolve) => {
    const beat = setInterval(() => {
      clearInterval(beat);
      resolve();
    }, ms);
  });
async function realUntil(predicate) {
  for (let tries = 0; !predicate(); tries++) {
    if (tries > 5000) throw new Error("fake model never streamed");
    await realPause();
  }
}
/** Advances mocked time in small steps until the promise settles; returns the mocked time spent. */
async function drive(t, promise, step = 500) {
  let settled = false,
    elapsed = 0;
  promise.then(
    () => (settled = true),
    () => {
      // allow-catch: only stop the fake clock; the original promise is awaited by the test.
      settled = true;
    },
  );
  while (!settled) {
    if (elapsed > 30 * 60_000) throw new Error("stage never settled");
    await realPause();
    t.mock.timers.tick(step);
    elapsed += step;
  }
  return elapsed;
}
async function stallScenario(t, reply, run) {
  const base = await mkdtemp(path.join(tmpdir(), "stage-model-"));
  const model = await fakeModel({ "mock-writer": [{ text: "warm" }] }, reply);
  try {
    const host = await stageHost(base, model.url);
    // One real request first builds the cached runtime, so only the stage request runs on mocked time.
    assert.equal(
      (await stageModel(host, "writer", PACKET, new AbortController().signal)).value,
      "warm",
    );
    model.calls.length = 0;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    return await run(host, model);
  } finally {
    t.mock.timers.reset();
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
}

test("stall watchdog: a stream that goes quiet after its first chunk stops at 150 s and is retried once", async (t) => {
  await stallScenario(
    t,
    () => ({ hang: "after-first" }),
    async (host, model) => {
      let failure;
      const pending = stageModel(host, "writer", PACKET, new AbortController().signal).catch(
        (error) => (failure = error),
      );
      await realUntil(() => model.streamed.length === 1);
      await realPause(50); // let the client take in the first chunk
      const elapsed = await drive(t, pending);
      assert.equal(failure.kind, "stalled", String(failure));
      assert.match(failure.message, /模型长时间无输出/);
      assert.equal(model.calls.length, 2, "first request plus one retry");
      // The first attempt stalled on the 150 s gap, not on the 6 minute first-event bound.
      assert.ok(elapsed >= 2 * 150_000 && elapsed < 360_000 + 150_000, String(elapsed));
    },
  );
});

test("stall watchdog: keep-alives are not progress; no content within 6 minutes stalls", async (t) => {
  await stallScenario(
    t,
    () => ({ hang: "keepalive" }),
    async (host, model) => {
      let failure;
      const pending = stageModel(host, "writer", PACKET, new AbortController().signal).catch(
        (error) => (failure = error),
      );
      const elapsed = await drive(t, pending);
      assert.equal(failure.kind, "stalled", String(failure));
      assert.equal(model.calls.length, 2);
      assert.ok(elapsed >= 2 * 360_000, String(elapsed));
    },
  );
});

test("stall watchdog: a model that keeps thinking past 150 s in total is not cut off", async (t) => {
  await stallScenario(
    t,
    () => ({ thinking: { count: 80, everyMs: 15 }, text: "答案" }),
    async (host, model) => {
      const pending = stageModel(host, "writer", PACKET, new AbortController().signal);
      // The fake model streams on real time, so mocked time per real tick must be large enough to
      // pass 150 s even where real timers are coarse (about 15 ms on Windows), yet small enough
      // that one gap between thinking chunks never reaches 150 s.
      const elapsed = await drive(t, pending, 2_500);
      assert.equal((await pending).value, "答案");
      assert.equal(model.calls.length, 1);
      assert.ok(elapsed > 150_000, String(elapsed));
    },
  );
});

test("author stop mid-stream: cancel semantics, billed usage kept, no content retry", async () => {
  const base = await mkdtemp(path.join(tmpdir(), "stage-model-"));
  const model = await fakeModel({}, () => ({
    hang: "after-first",
    usage: { prompt_tokens: 50, completion_tokens: 3 },
  }));
  try {
    const host = await stageHost(base, model.url);
    const journal = await journalIn(base);
    const controller = new AbortController();
    const pending = journal.step(
      "s",
      "阶段",
      { parse: (v) => v },
      () => stageModel(host, "writer", PACKET, controller.signal),
      controller.signal,
      1,
    );
    await realUntil(() => model.streamed.length === 1);
    await realPause(50);
    controller.abort();
    await assert.rejects(
      pending,
      (error) => error.kind === "aborted" && error.message === "已取消",
    );
    const [row] = journal.record.steps;
    assert.equal(row.usage.input, 50, "the part billed before the stop is recorded");
    assert.equal(row.attempts, 1);
    assert.equal(model.calls.length, 1);
  } finally {
    await model.close();
    await rm(base, { recursive: true, force: true });
  }
});

test("journal: a first-run acceptance failure is a content failure that is retried, and the narrowed value is what gets saved", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const journal = await journalIn(dir);
    const seen = [];
    const value = await journal.step(
      "titles",
      "标题",
      {
        parse: (value) => value,
        accept: (value) => {
          const fresh = value.filter((title) => title !== "旧题");
          if (!fresh.length) throw new Error("标题与近期文章重复");
          return fresh;
        },
      },
      async (attempt) => {
        seen.push(attempt.lastError);
        return { value: attempt.index ? ["旧题", "新题"] : ["旧题"], usage: usage(1) };
      },
      new AbortController().signal,
      1,
    );
    assert.deepEqual(value, ["新题"]);
    assert.deepEqual(seen, [undefined, "标题与近期文章重复"]);
    const disk = JSON.parse(await readFile(path.join(dir, "w.json"), "utf8"));
    assert.deepEqual(disk.steps[0].output, ["新题"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("journal: open rejects an invalid request before anything is written", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "stage-retry-"));
  try {
    const file = path.join(dir, "w.json");
    await assert.rejects(
      WorkflowJournal.open(file, {}, "h", "b", () => {}),
      /流水线请求须为对象|流水线类型无效/,
    );
    await assert.rejects(
      WorkflowJournal.open(file, { ...REQUEST, chapter: "../c1" }, "h", "b", () => {}),
      /章节标识无效/,
    );
    await assert.rejects(readFile(file), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
