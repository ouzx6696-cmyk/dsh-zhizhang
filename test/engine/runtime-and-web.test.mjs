import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";

const desk = await importBundle("test/support/desktop-entry.ts");

test("RunStore 隔离损坏记录并按 maxTerminalRuns 裁剪历史终态运行", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-runs-"));
  try {
    const corruptEvents = [];
    const store = desk.createRunStore(dir, {
      maxTerminalRuns: 2,
      onCorrupt: (file, err) => corruptEvents.push({ file, code: err.code }),
    });

    const target = { mode: "fanqie", path: path.join(dir, "book") };
    const makeRec = (id, created) => ({
      format: desk.FORMAT_VERSION,
      id,
      kind: "fanqie.chapter",
      target,
      request: {},
      state: "applied",
      stateHistory: [{ to: "applied", reason: "ok", at: created }],
      steps: [],
      usage: { calls: 0, input: 0, output: 0, cached: 0, cost: 0 },
      budget: { inputBudget: 1000, runBudget: 10000, moneyCap: 5 },
      created,
      updated: created,
    });

    await store.save(makeRec("run-1", "2026-01-01T00:00:01.000Z"));
    await store.save(makeRec("run-2", "2026-01-01T00:00:02.000Z"));
    await store.save(makeRec("run-3", "2026-01-01T00:00:03.000Z"));

    const subdirs = await fs.readdir(dir, { withFileTypes: true });
    const targetSub = subdirs.find((d) => d.isDirectory());
    assert.ok(targetSub, "应创建目标运行目录");
    await fs.writeFile(path.join(dir, targetSub.name, "run-corrupt.json"), "{ broken json", "utf8");

    const listed = await store.list(target);
    assert.deepEqual(
      listed.map((r) => r.id),
      ["run-3", "run-2"],
      "最旧的终态 run-1 应被裁剪，损坏记录应被跳过",
    );
    assert.equal(corruptEvents.length, 1);
    assert.ok(corruptEvents[0].file.endsWith("run-corrupt.json"));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("ConfigService 为 secrets.bin 设置 0600 权限且 onChange 返回可取消订阅函数", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-cfg-"));
  try {
    const cipher = {
      available: () => true,
      encrypt: (plain) => Buffer.from(plain, "utf8").toString("base64"),
      decrypt: (cipherText) => Buffer.from(cipherText, "base64").toString("utf8"),
    };
    const cfg = await desk.createConfigService({ stateRoot: dir, cipher });

    let notifications = 0;
    const dispose = cfg.onChange(() => {
      notifications += 1;
    });

    await cfg.saveModels({
      connections: [
        {
          id: "c1",
          label: "测试连接",
          provider: "openai",
          api: "openai-completions",
          baseUrl: "https://example.invalid/v1",
          keyless: false,
          contextWindow: 32_000,
          maxTokens: 4096,
        },
      ],
      keys: { c1: "sk-test-secret" },
      roles: {},
    });
    assert.equal(notifications, 1);

    if (process.platform !== "win32") {
      const stat = await fs.stat(path.join(dir, "secrets.bin"));
      assert.equal(stat.mode & 0o777, 0o600, "secrets.bin 应仅属主可读写");
    }

    dispose();
    await cfg.savePatch({
      appearance: { ...desk.DEFAULT_SETTINGS.appearance, theme: "dark" },
    });
    assert.equal(notifications, 1, "取消订阅后不应再收到变更通知");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("runTool 截断超过 24000 字符的工具输出并附带省略提示", async () => {
  const clock = createFakeClock();
  const bigTool = desk.defineTool({
    name: "big_echo",
    description: "返回超长文本",
    roles: ["assistant"],
    readonly: true,
    params: desk.obj({}),
    run: async () => ({ text: "甲".repeat(30_000) }),
    render: (v) => v.text,
  });

  const outcome = await desk.runTool(
    [bigTool],
    { id: "call-1", name: "big_echo", args: {} },
    { role: "assistant", target: { mode: "fanqie", path: "/tmp" }, clock },
  );
  assert.equal(outcome.isError, false);
  assert.ok(outcome.text.length < 25_000);
  assert.ok(outcome.text.includes("工具返回已截断"));
});

test("SessionManager 并发执行连续只读工具并串行拦截同目标并发 send", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-session-"));
  try {
    const clock = createFakeClock();
    const target = { mode: "fanqie", path: dir };
    let activeReadonly = 0;
    let peakReadonly = 0;
    let releaseFirstTurn;
    const firstTurnEntered = new Promise((resolve) => {
      releaseFirstTurn = resolve;
    });
    let continueTurn;
    const waitTurn = new Promise((resolve) => {
      continueTurn = resolve;
    });

    const slowReadA = desk.defineTool({
      name: "read_a",
      description: "只读工具A",
      roles: ["assistant"],
      readonly: true,
      params: desk.obj({}),
      run: async () => {
        activeReadonly += 1;
        peakReadonly = Math.max(peakReadonly, activeReadonly);
        await new Promise((r) => setTimeout(r, 25));
        activeReadonly -= 1;
        return { value: "A" };
      },
    });
    const slowReadB = desk.defineTool({
      name: "read_b",
      description: "只读工具B",
      roles: ["assistant"],
      readonly: true,
      params: desk.obj({}),
      run: async () => {
        activeReadonly += 1;
        peakReadonly = Math.max(peakReadonly, activeReadonly);
        await new Promise((r) => setTimeout(r, 25));
        activeReadonly -= 1;
        return { value: "B" };
      },
    });

    let turnCount = 0;
    let resolveDone;
    const turnFinished = new Promise((resolve) => {
      resolveDone = resolve;
    });
    const fakePi = {
      turn: async () => {
        turnCount += 1;
        if (turnCount === 1) {
          releaseFirstTurn();
          await waitTurn;
          return {
            text: "",
            toolCalls: [
              { id: "tc-1", name: "read_a", args: {} },
              { id: "tc-2", name: "read_b", args: {} },
            ],
            usage: { input: 10, output: 10, cachedInput: 0 },
            cost: null,
          };
        }
        return {
          text: "读取完成",
          toolCalls: [],
          usage: { input: 10, output: 10, cachedInput: 0 },
          cost: null,
        };
      },
    };

    const gateway = desk.createModelGateway(
      createFakeModelPort([{ text: "ok" }]),
      {
        globalConcurrency: 2,
        perRunConcurrency: 2,
        roles: { assistant: { connection: "c1", model: "m1" } },
      },
      clock,
    );

    const manager = desk.createSessionManager({
      clock,
      store: desk.createConversationStore(path.join(dir, "conv"), clock),
      gateway: () => gateway,
      port: () => fakePi,
      binding: () => ({ connection: "c1", model: "m1", contextWindow: 32_000, maxTokens: 4096 }),
      tools: () => [slowReadA, slowReadB],
      toolCtx: (t) => ({ role: "assistant", target: t, clock }),
      context: () => desk.DEFAULT_SETTINGS.context,
      preferences: () => "",
      readonly: () => false,
      title: async () => "测试作品",
      emit: (ev) => {
        if (ev.kind === "session" && ev.event.type === "end") resolveDone();
      },
    });

    const firstSend = manager.send(target, { text: "同时读取两个只读项" });
    await firstTurnEntered;

    await assert.rejects(
      () => manager.send(target, { text: "并发插入消息" }),
      (err) => desk.isAppError(err, "gate.denied"),
    );

    continueTurn();
    await firstSend;
    await turnFinished;
    assert.equal(peakReadonly, 2, "连续只读工具应并发执行");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("Web 预览服务器拦截跨源 RPC、非 JSON 请求与目录穿越访问", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-web-"));
  const stateRoot = path.join(dir, "state");
  const workspaceRoot = path.join(dir, "workspace");
  const staticDir = path.join(dir, "static");
  await fs.mkdir(staticDir, { recursive: true });
  await fs.writeFile(
    path.join(staticDir, "index.html"),
    "<!doctype html><title>OK</title>",
    "utf8",
  );

  const srv = await desk.startWebPreviewServer({
    host: "127.0.0.1",
    port: 0,
    repoRoot: process.cwd(),
    stateRoot,
    workspaceRoot,
    staticDir,
  });

  try {
    const addr = srv.server.address();
    const port = typeof addr === "object" && addr ? addr.port : srv.port;
    const base = `http://127.0.0.1:${port}`;

    const crossOrigin = await fetch(`${base}/api/rpc/app.state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: JSON.stringify({ args: [] }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(crossOrigin.headers.get("x-content-type-options"), "nosniff");

    const wrongType = await fetch(`${base}/api/rpc/app.state`, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Origin: base,
      },
      body: "not-json",
    });
    const wrongBody = await wrongType.json();
    assert.equal(wrongBody.ok, false);
    assert.equal(wrongBody.error.code, "ipc.invalid_args");

    const okRes = await fetch(`${base}/api/rpc/app.state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: base,
      },
      body: JSON.stringify({ args: [] }),
    });
    assert.equal(okRes.status, 200);
    const okBody = await okRes.json();
    assert.equal(okBody.ok, true);
    assert.equal(okBody.value.platform, process.platform);

    const healthRes = await fetch(`${base}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthBody = await healthRes.json();
    assert.equal(healthBody.ok, true);
    assert.equal(healthBody.workspaceConfigured, true);
    assert.equal(healthBody.authRequired, false);
    assert.equal("workspace" in healthBody, false, "/api/health 不应暴露宿主机绝对路径");

    const traversal = await fetch(`${base}/%2e%2e/state/settings.json`);
    const traversalText = await traversal.text();
    assert.ok(!traversalText.includes("connections"), "路径穿越不得读取 staticDir 之外的文件");

    const exportTraversal = await fetch(`${base}/api/exports/..%2Fsettings.json`);
    assert.ok(
      exportTraversal.status === 400 || exportTraversal.status === 403,
      `导出路径穿越应返回 400/403，实际 ${exportTraversal.status}`,
    );
  } finally {
    await srv.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
