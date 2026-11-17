import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { workspace, treeOps, provenance } from "../support/v14.mjs";
import { importBundle } from "../support/bundle.mjs";
const desk = await importBundle("test/support/desktop-entry.ts");
test("新增十个助手工具 → 公共入口可读可提案，写入动作在只读模式被拦截", async (t) => {
  const env = await workspace(t),
    { work, base, library, store } = env,
    { ops, ids } = treeOps(1, 1, 1);
  await store.apply(work, ops, 0);
  const index = await (await import("../support/v14.mjs")).bible.readBibleIndex(work);
  await library.apply(
    work,
    [
      {
        type: "entity.upsert",
        entity: {
          id: "ent-1",
          kind: "character",
          name: "林川",
          aliases: [],
          summary: "守灯人",
          locked: [],
          provenance,
          rev: 0,
        },
      },
    ],
    Math.max(...Object.values(index.files).map((x) => x.rev)),
  );
  const target = { mode: "fanqie", path: work },
    tools = desk.fanqieModule.tools("assistant", target),
    byName = (name) => tools.find((t) => t.name === name),
    started = [],
    navigated = [];
  const ctx = {
    workspaceRoot: base,
    readonly: false,
    host: {
      startPipeline: async (kind, request) => {
        started.push({ kind, request });
        return { runId: "run-1", kind };
      },
      navigate: (focus) => navigated.push(focus),
    },
  };
  assert.equal(tools.length, 23);
  assert.equal(new Set(tools.map((t) => t.name)).size, 23);
  const reads = {
    fanqie_outline_tree: { depth: 3 },
    fanqie_outline_node: { id: ids[0] },
    fanqie_bible_search: { query: "林川", position: 1 },
    fanqie_bible_entity: { id: "ent-1", position: 1 },
    fanqie_threads: { position: 1 },
    fanqie_facts_recent: { position: 1 },
    fanqie_check: { upTo: 1 },
  };
  for (const [name, args] of Object.entries(reads)) {
    const value = await desk.executeTool(byName(name), args, ctx);
    assert.equal(value.ok, true, name);
    assert.ok(JSON.stringify(value).length <= 4100);
  }
  const input = {
    ops: [{ type: "node.update", id: ids[0], expectedRev: 0, patch: { title: "提案标题" } }],
    reason: "补足回报",
  };
  const pending = await desk.executeTool(byName("fanqie_propose"), input, ctx);
  assert.equal(pending.ok, true);
  assert.equal((await store.get(work)).nodes.at(-1).title, "第1章");
  assert.equal(
    (await library.readPendingBatch(work, pending.batch)).items[0].decision,
    "undecided",
  );
  assert.equal(
    (
      await desk.executeTool(
        byName("fanqie_propose"),
        { ...input, ops: Array(21).fill(input.ops[0]) },
        ctx,
      )
    ).code,
    "input.invalid",
  );
  for (const name of ["fanqie_propose", "fanqie_start_ledger"]) {
    const result = await desk.executeTool(
      byName(name),
      name === "fanqie_propose" ? input : { chapterId: "ch-1" },
      { ...ctx, readonly: true },
    );
    assert.equal(result.code, "storage.locked");
  }
  await desk.executeTool(byName("fanqie_start_ledger"), { chapterId: "ch-1" }, ctx);
  assert.equal(started[0].kind, "fanqie.ledger");
  await desk.executeTool(byName("fanqie_open_plan"), { target: "entity", id: "ent-1" }, ctx);
  assert.deepEqual(navigated[0], { view: "plan", tab: "library", id: "ent-1" });
});
for (const phase of ["current", "save"])
  test(`发送消息的 ${phase} 尚未完成就停止 → 不发起模型且 busy 复原`, async (t) => {
    const env = await workspace(t),
      target = { mode: "fanqie", path: env.work },
      store = desk.createConversationStore(path.join(env.base, "sessions"), env.clock);
    let release, enter;
    const entered = new Promise((resolve) => (enter = resolve)),
      gate = new Promise((resolve) => (release = resolve)),
      events = [];
    const wrapped = {
      ...store,
      [phase]: async (...args) => {
        enter();
        await gate;
        return store[phase](...args);
      },
    };
    const sessions = desk.createSessionManager({
      clock: env.clock,
      store: wrapped,
      gateway: () => assert.fail("停止后不应取 gateway"),
      port: () => assert.fail("停止后不应取 port"),
      binding: () => ({ connection: "fake", model: "fake", contextWindow: 64000, maxTokens: 1000 }),
      tools: () => [],
      toolCtx: () => ({ workspaceRoot: env.base, readonly: false }),
      context: () => desk.DEFAULT_SETTINGS.context,
      preferences: () => "",
      readonly: () => false,
      title: async () => "夜航",
      emit: (e) => events.push(e),
    });
    const sending = sessions.send(target, { text: "继续", intent: "revise", focus: {} });
    await entered;
    await sessions.stop(target);
    release();
    await sending;
    await sessions.idle(target);
    assert.equal((await sessions.view(target)).busy, false);
    assert.ok(!events.some((e) => e.event?.type === "delta"));
    sessions.dispose();
  });
