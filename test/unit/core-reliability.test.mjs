import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { AppError } = await importTs("packages/core/src/errors/index.ts");
const { clearStaleLock, createLockService, inspectStaleLocks } = await importTs(
  "packages/core/src/lock/index.ts",
);
const { emptyUsage, executePipeline } = await importTs("packages/core/src/pipeline/index.ts");
const desk = await importBundle("test/support/desktop-entry.ts");

function makeRunRecord(id, kind, now) {
  return {
    format: 1,
    id,
    kind,
    target: { mode: "fanqie", path: "/tmp/w" },
    request: {},
    state: "running",
    stateHistory: [{ state: "running", at: now }],
    steps: [],
    usage: emptyUsage(),
    budget: { inputBudget: 1000, runBudget: 5000, moneyCap: null },
    created: now,
    updated: now,
  };
}

test("inspectStaleLocks 与 clearStaleLock 可识别并安全清理孤立空锁目录", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-orphan-lock-"));
  try {
    const lockDir = path.join(dir, ".zhizhang-lock-work-book1");
    await fs.mkdir(lockDir);

    // 刚创建的空锁在默认 15s 宽限期内不应误判为孤立锁
    const withinGrace = await inspectStaleLocks(dir);
    assert.equal(withinGrace.length, 0);

    // 超过宽限期后识别为孤立锁
    const orphans = await inspectStaleLocks(dir, { orphanGraceMs: 0 });
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].orphan, true);
    assert.equal(orphans[0].pid, 0);

    // 作者确认后清理成功
    await clearStaleLock(orphans[0], { confirmedByAuthor: true, at: "2026-01-01T00:00:00.000Z" });
    await assert.rejects(() => fs.stat(lockDir));

    // 若并发期间有活进程写入 owner.json，则拒绝误删
    await fs.mkdir(lockDir);
    await fs.writeFile(
      path.join(lockDir, "owner.json"),
      JSON.stringify({
        owner: `${os.hostname()}:${process.pid}`,
        pid: process.pid,
        host: os.hostname(),
        acquiredAt: "2026-01-01T00:00:00.000Z",
      }),
      "utf8",
    );
    await assert.rejects(
      () => clearStaleLock(orphans[0], { confirmedByAuthor: true, at: "2026-01-01T00:00:00.000Z" }),
      (err) => err?.code === "storage.locked",
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("StorageHealth 可扫描并清理位于工作区父目录的残留工作区租约写锁", async () => {
  const parentDir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-health-parent-"));
  const wsRoot = path.join(parentDir, "my-workspace");
  const fanqieRoot = path.join(wsRoot, "长篇");
  const toutiaoRoot = path.join(wsRoot, "头条");
  const libraryRoot = path.join(wsRoot, "拆书库");
  await fs.mkdir(fanqieRoot, { recursive: true });
  await fs.mkdir(toutiaoRoot, { recursive: true });
  await fs.mkdir(libraryRoot, { recursive: true });

  try {
    const staleLeaseLock = path.join(parentDir, ".zhizhang-lock-work-my-workspace");
    await fs.mkdir(staleLeaseLock);
    await fs.writeFile(
      path.join(staleLeaseLock, "owner.json"),
      JSON.stringify({
        owner: `${os.hostname()}:999999`,
        pid: 999999,
        host: os.hostname(),
        acquiredAt: "2026-01-01T00:00:00.000Z",
      }),
      "utf8",
    );

    const clock = createFakeClock();
    const health = desk.createStorageHealth({
      locks: createLockService(clock),
      runs: { listAll: async () => [] },
      clock,
      workspace: () => ({
        root: wsRoot,
        configured: true,
        readonly: false,
        roots: { fanqie: fanqieRoot, toutiao: toutiaoRoot, library: libraryRoot },
      }),
      cancelRun: async () => undefined,
    });

    const before = await health.inspect();
    assert.ok(
      before.staleLocks.some((l) => l.lockDir === staleLeaseLock),
      "应巡检出父目录中的工作区租约残留锁",
    );

    const after = await health.recover({ kind: "clear-lock", lockDir: staleLeaseLock });
    assert.equal(after.staleLocks.length, 0);
    await assert.rejects(() => fs.stat(staleLeaseLock));
  } finally {
    await fs.rm(parentDir, { recursive: true, force: true });
  }
});

test("executePipeline 优先响应作者 stop(cancelled) 且 fanOut 支持 allowPartial 部分存活", async () => {
  const clock = createFakeClock();

  // 1. signal.aborted("cancelled") 优先于可暂停错误（network.timeout）
  const ac = new AbortController();
  const stopDef = {
    kind: "test.stop",
    request: (v) => v,
    context: async (target, req) => ({ runId: "r-stop", target, request: req, state: {} }),
    async run() {
      ac.abort("cancelled");
      throw new AppError("network.timeout", "连接超时");
    },
    async deliver() {
      return { runId: "r-stop", deliveredPaths: [], contentHash: "h", summary: "" };
    },
    async recover() {
      return "resume";
    },
  };
  const stopRec = makeRunRecord("r-stop", "test.stop", clock.iso());
  const stopOut = await executePipeline(
    stopDef,
    stopRec,
    { runId: "r-stop", target: stopRec.target, request: {}, state: {} },
    { run: async () => ({ text: "", usage: { input: 0, cachedInput: 0, output: 0 }, cost: 0 }) },
    clock,
    ac.signal,
  );
  assert.equal(stopOut.state, "cancelled", "作者明确 stop 时应进入 cancelled 而非 paused");

  // 2. fanOut allowPartial=true 在 3 路中 1 路失败时保留其余 2 路候选
  let deliveredDrafts = [];
  const partialDef = {
    kind: "test.partial",
    request: (v) => v,
    context: async (target, req) => ({ runId: "r-partial", target, request: req, state: {} }),
    async run(runner) {
      return runner.fanOut(
        {
          id: "draft",
          title: "多路起稿",
          role: "writer",
          input: () => "go",
          shape: "text",
          format: "text",
          parse: (raw) => raw,
          retries: 0,
          fanOut: { count: () => 3, allowPartial: true },
        },
        { prefix: [], suffix: [], omitted: [], estimate: 10 },
      );
    },
    async deliver(res) {
      deliveredDrafts = res;
      return { runId: "r-partial", deliveredPaths: [], contentHash: "h", summary: "" };
    },
    async recover() {
      return "resume";
    },
  };
  let callIndex = 0;
  const partialGateway = {
    async run() {
      callIndex += 1;
      if (callIndex === 2) throw new AppError("network.timeout", "单路超时");
      return {
        text: `候选稿-${callIndex}`,
        usage: { input: 10, cachedInput: 0, output: 20 },
        cost: 0.01,
      };
    },
  };
  const partialRec = makeRunRecord("r-partial", "test.partial", clock.iso());
  const partialOut = await executePipeline(
    partialDef,
    partialRec,
    { runId: "r-partial", target: partialRec.target, request: {}, state: {} },
    partialGateway,
    clock,
    new AbortController().signal,
  );
  assert.equal(partialOut.state, "awaiting-author");
  assert.deepEqual(deliveredDrafts, ["候选稿-1", "候选稿-3"]);
});
