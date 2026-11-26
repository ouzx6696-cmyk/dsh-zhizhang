import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { FORMAT_VERSION } = await importTs("packages/core/src/paths.ts");
const { createModelGateway } = await importTs("packages/core/src/model/index.ts");
const { definePipeline, emptyUsage, executePipeline } = await importTs(
  "packages/core/src/pipeline/index.ts",
);
const { obj } = await importTs("packages/core/src/schema/index.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { createBibleStore } = await importTs("packages/fanqie/src/bible/index.ts");
const desk = await importBundle("test/support/desktop-entry.ts");

const EMPTY_PACKET = { prefix: [], suffix: [], omitted: [], estimate: 0 };

function makeRunRecord(id, kind, target, request, nowIso) {
  return {
    format: FORMAT_VERSION,
    id,
    kind,
    target,
    request,
    state: "running",
    stateHistory: [{ to: "running", reason: "start", at: nowIso }],
    steps: [],
    usage: emptyUsage(),
    budget: { inputBudget: 8000, runBudget: 100000, moneyCap: 10 },
    created: nowIso,
    updated: nowIso,
  };
}

test("StageRunner fanOut 并发阶段串行合并状态、完整落盘且按序发射 PipelineEvent", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-fanout-"));
  try {
    const clock = createFakeClock();
    const port = createFakeModelPort([{ text: "分支A" }, { text: "分支B" }, { text: "分支C" }]);
    const gateway = createModelGateway(
      port,
      {
        globalConcurrency: 4,
        perRunConcurrency: 4,
        roles: { writer: { connection: "c1", model: "m1" } },
      },
      clock,
    );
    const events = [];
    const persisted = [];

    const pipeline = definePipeline({
      kind: "test.fanout",
      request: obj({}),
      async context(target, req, env) {
        return {
          runId: "run-fanout-1",
          target,
          request: req,
          state: { outputs: [] },
          clock: env.clock ?? clock,
          lock: env.lock ?? createLockService(clock),
        };
      },
      async run(runner, ctx) {
        const outputs = await runner.fanOut(
          {
            id: "draft",
            title: "多路起稿",
            role: "writer",
            input: () => ({}),
            shape: "纯文本",
            format: "text",
            parse: (raw) => raw.trim(),
            fanOut: { count: () => 3 },
          },
          EMPTY_PACKET,
        );
        ctx.state.outputs = outputs;
        return outputs;
      },
      async deliver(res, ctx) {
        return {
          runId: ctx.runId,
          deliveredPaths: [],
          contentHash: "hash",
          summary: `${res.length}`,
        };
      },
    });

    const target = { mode: "fanqie", path: dir };
    const ctx = await pipeline.context(target, {}, { clock });
    const record = makeRunRecord(ctx.runId, pipeline.kind, target, {}, clock.iso());
    const ac = new AbortController();
    const finalRecord = await executePipeline(pipeline, record, ctx, gateway, clock, ac.signal, {
      onPersist: async (rec) => {
        persisted.push(rec.steps.length);
      },
      onEvent: (ev) => {
        events.push(ev);
      },
    });

    assert.equal(finalRecord.format, "zhizhang/2.0");
    assert.equal(finalRecord.state, "awaiting-author");
    assert.equal(finalRecord.steps.length, 3);
    assert.deepEqual(finalRecord.steps.map((s) => s.id).sort(), ["draft-0", "draft-1", "draft-2"]);
    assert.equal(events.filter((e) => e.type === "stage.start").length, 3);
    assert.equal(events.filter((e) => e.type === "stage.done").length, 3);
    assert.ok(persisted.includes(3));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("BibleStore.decide 通过 commitIntent 原子提交并清理临时意图日志", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-bible-commit-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const store = createBibleStore(lock, clock);
    const added = await store.propose(
      dir,
      [
        {
          type: "entity.upsert",
          entity: {
            id: "e-hero",
            kind: "character",
            name: "苏晚",
            aliases: [],
            summary: "药铺学徒",
            locked: [],
            provenance: { source: "author", at: clock.iso() },
          },
        },
      ],
      { source: "author", at: clock.iso() },
    );

    await store.decide(dir, added[0].id, "accept");
    const updated = await store.read(dir);
    assert.equal(updated.entities.length, 1);
    assert.equal(updated.pending.length, 0);
    const entitiesDisk = JSON.parse(
      await fs.readFile(path.join(dir, "bible", "entities.json"), "utf8"),
    );
    assert.equal(entitiesDisk[0].name, "苏晚");
    const indexDisk = JSON.parse(await fs.readFile(path.join(dir, "bible", "index.json"), "utf8"));
    assert.equal(indexDisk.format, "zhizhang/2.0");
    const journalEntries = await fs.readdir(path.join(dir, ".journal"));
    assert.deepEqual(journalEntries, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("createRpcHandlers 提供传输无关 RPC 分发并校验只读模式写命令门禁", async () => {
  let readonly = true;
  const clock = createFakeClock();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-rpc-"));
  try {
    const fakeServices = {
      version: desk.APP_VERSION,
      clock,
      host: {
        platform: "web",
        pickFolder: async () => null,
        pickTextFile: async () => null,
        saveFile: async () => null,
        openPath: async () => {},
        revealPath: async () => {},
        copyText: () => {},
      },
      emit: () => {},
      config: {
        publicSettings: () => desk.DEFAULT_SETTINGS,
        issue: () => undefined,
        savePatch: async () => desk.DEFAULT_SETTINGS,
        reset: async () => desk.DEFAULT_SETTINGS,
        saveModels: async () => desk.DEFAULT_SETTINGS,
      },
      workspace: {
        status: () => ({
          root: dir,
          readonly,
          roots: {
            fanqie: path.join(dir, "长篇"),
            toutiao: path.join(dir, "头条"),
            library: path.join(dir, "拆书库"),
          },
          problems: [],
        }),
        assertWritable() {
          if (readonly) throw new desk.AppError("storage.locked", "只读模式");
        },
        assertInside() {},
        close: async () => {},
      },
      openWorkspace: async () => ({
        root: dir,
        readonly,
        roots: { fanqie: dir, toutiao: dir, library: dir },
        problems: [],
      }),
      workflow: {
        start: async () => ({ target: { mode: "fanqie", path: dir }, runId: "r1" }),
        control: async () => {},
        decide: async () => {},
        get: async () => undefined,
        history: async () => [],
        running: () => [],
      },
      sessions: {
        view: async () => ({
          conversationId: "c1",
          messages: [],
          running: false,
          streaming: "",
          usage: { tokens: 0, window: 64000, percent: 0 },
        }),
        send: async () => {},
        stop: async () => {},
        list: async () => [],
        newConversation: async () => "c2",
        usage: async () => ({ tokens: 0, window: 64000, percent: 0 }),
        compact: async () => ({ before: 0, after: 0 }),
        running: () => [],
      },
      models: {
        test: async () => ({ ok: true, latencyMs: 1 }),
        catalog: async () => [],
      },
      storage: {
        inspect: async () => ({ locks: [], intents: [] }),
        clearLocks: async () => 0,
        replayIntents: async () => ({ replayed: 0, conflicts: [] }),
      },
      commands: {
        lock: createLockService(clock),
        clock,
        inside: (p) => p,
        profiles: { builtin: () => "", userDir: dir },
        workflow: {
          start: async () => ({ target: { mode: "fanqie", path: dir }, runId: "r1" }),
        },
      },
      backup: {
        start: async () => ({ file: "/tmp/b.zip", sha256: "abc", files: 1 }),
        cancel: () => {},
      },
      diagnostics: async () => {},
      updates: () => ({ status: "idle", current: desk.APP_VERSION }),
      learning: async () => ({
        mode: "fanqie",
        recent: [],
        profile: { id: "default", name: "默认", builtin: true, mode: "fanqie" },
      }),
    };

    const rpc = desk.createRpcHandlers(fakeServices);
    const stateReply = await rpc.invoke("app.state", []);
    assert.equal(stateReply.ok, true);
    assert.equal(stateReply.value.version, desk.APP_VERSION);
    assert.equal(stateReply.value.platform, "web");
    assert.equal(stateReply.value.workspace.readonly, true);

    const blockedReply = await rpc.invoke("workbench.call", [
      { command: "fanqie.chapter.save", input: {} },
    ]);
    assert.equal(blockedReply.ok, false);
    assert.equal(blockedReply.error.code, "storage.locked");

    readonly = false;
    const listReply = await rpc.invoke("workbench.call", [
      { command: "fanqie.chapter.list", input: { work: dir } },
    ]);
    assert.equal(listReply.ok, true);
    assert.deepEqual(listReply.value.rows, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
