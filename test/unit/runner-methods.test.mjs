import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { loadProfile, methodFor } = await importTs("packages/core/src/methods/index.ts");
const { createModelGateway } = await importTs("packages/core/src/model/index.ts");
const { AppError } = await importTs("packages/core/src/errors/index.ts");
const { executePipeline, emptyUsage } = await importTs("packages/core/src/pipeline/index.ts");

test("stage-map.json extracts configured sections and injects method text into pipeline via fake-port", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-runner-methods-"));
  try {
    const profileDir = path.join(dir, "default");
    await fs.mkdir(profileDir, { recursive: true });
    await fs.writeFile(
      path.join(profileDir, "profile.json"),
      JSON.stringify({ name: "默认测试方案" }),
      "utf8",
    );
    await fs.writeFile(
      path.join(profileDir, "guide.md"),
      "# 写作指南\n\n## 目标节\n第一条：开篇三百字立住冲突。\n\n## 无关节\n这段不应被注入。\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(profileDir, "stage-map.json"),
      JSON.stringify({
        draft: {
          take: [
            { file: "guide.md", sections: ["目标节"] },
            { file: "missing.md", sections: ["不存在"] },
          ],
        },
      }),
      "utf8",
    );

    const profile = await loadProfile("fanqie", "default", { builtinDir: dir });
    const method = methodFor(profile, "draft");
    assert.ok(method.text.includes("开篇三百字立住冲突"));
    assert.ok(!method.text.includes("这段不应被注入"));
    assert.ok(method.omitted.includes("missing.md"));

    const port = createFakeModelPort([{ text: "正文候选一：冲突已立住。" }]);
    const clock = createFakeClock(1_700_000_000_000);
    const gateway = createModelGateway(
      port,
      {
        globalConcurrency: 2,
        perRunConcurrency: 2,
        roles: { writer: { connection: "mock", model: "mock-writer" } },
      },
      clock,
    );

    let delivered = "";
    const def = {
      id: "fanqie.chapter",
      async run(runner) {
        return runner.stage(
          {
            id: "draft",
            role: "writer",
            format: "text",
            input: () => "第1章：风起",
            parse: (raw) => raw.trim(),
          },
          {
            prefix: [
              {
                id: "method-draft",
                layer: 0,
                text: method.text,
                required: true,
                tokens: 50,
                reason: "stage-map.json 注入",
                source: { kind: "plan", ref: "draft" },
              },
            ],
            suffix: [],
            omitted: [],
            estimate: 50,
          },
        );
      },
      async deliver(res) {
        delivered = res;
        return { kind: "chapter", ref: "ch-1", summary: res };
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

    const finalRecord = await executePipeline(
      def,
      record,
      { workPath: dir, profile, state: {} },
      gateway,
      clock,
      new AbortController().signal,
    );

    assert.equal(finalRecord.state, "awaiting-author");
    assert.equal(delivered, "正文候选一：冲突已立住。");
    assert.equal(port.calls.length, 1);
    assert.ok(port.calls[0].system.includes("开篇三百字立住冲突"));
    assert.ok(!port.calls[0].system.includes("这段不应被注入"));
    assert.ok(port.calls[0].user.includes("第1章：风起"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("builtin fanqie and toutiao stage-map.json resolve non-empty methods via methodFor", async () => {
  const fanqieProfile = await loadProfile("fanqie", "default", {
    builtinDir: path.join(process.cwd(), "packages/fanqie/profiles"),
  });
  const toutiaoProfile = await loadProfile("toutiao", "default", {
    builtinDir: path.join(process.cwd(), "packages/toutiao/profiles"),
  });

  for (const [profile, stage] of [
    [fanqieProfile, Object.keys(fanqieProfile.stageMap)[0]],
    [toutiaoProfile, Object.keys(toutiaoProfile.stageMap)[0]],
  ]) {
    assert.ok(stage, `Expected at least one stage in ${profile.mode} stage-map.json`);
    const res = methodFor(profile, stage);
    assert.ok(res.text.length > 0, `Expected non-empty method text for ${profile.mode}:${stage}`);
    assert.ok(res.hash.length > 0);
  }
});

test("无效回答重试后用量完整保留，恢复直接复用已验收的输出", async () => {
  const clock = createFakeClock();
  const port = createFakeModelPort([
    { text: "bad", usage: { input: 10, cachedInput: 0, output: 5 }, cost: 1 },
    { text: '{"body":"正文"}', usage: { input: 10, cachedInput: 0, output: 5 }, cost: 1 },
  ]);
  const gateway = createModelGateway(
    port,
    {
      globalConcurrency: 1,
      perRunConcurrency: 1,
      roles: {},
    },
    clock,
  );
  const def = {
    async run(runner) {
      return runner.stage(
        {
          id: "draft",
          role: "writer",
          input: () => "起稿",
          parse(raw) {
            if (raw === "bad") throw new AppError("model.output_invalid", "输出无效");
            return JSON.parse(raw);
          },
        },
        { prefix: [], suffix: [], omitted: [], estimate: 0 },
      );
    },
    async deliver(value) {
      assert.deepEqual(value, { body: "正文" });
    },
  };
  const record = {
    id: "retry",
    kind: "probe",
    state: "running",
    stateHistory: [],
    steps: [],
    usage: emptyUsage(),
    budget: { inputBudget: 1000, runBudget: 1000, moneyCap: null },
  };
  const result = await executePipeline(
    def,
    record,
    {},
    gateway,
    clock,
    new AbortController().signal,
  );
  assert.deepEqual(result.usage, { input: 20, cachedInput: 0, output: 10, cost: 2 });
  await executePipeline(
    def,
    { ...result, state: "running" },
    {},
    gateway,
    clock,
    new AbortController().signal,
  );
  assert.equal(port.calls.length, 2);
});
