import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { workspace, chapter, provenance, bible, runPipeline, treeOps } from "../support/v14.mjs";
import { importTs } from "../support/ts-loader.mjs";
import { importBundle } from "../support/bundle.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
const { ledgerPipeline } = await importTs("packages/fanqie/src/pipelines/ledger/index.ts"),
  { createModelGateway } = await importTs("packages/core/src/model/index.ts"),
  { updateWorkSettings } = await importTs("packages/fanqie/src/commands/work.ts"),
  { afterFinalize } = await importTs("apps/desktop/src/main/commands-ledger.ts");
const desk = await importBundle("test/support/desktop-entry.ts");
test("记账 v2 → 定位证据、计划兑现、实体类型、知情持有人和伏笔回收均先进入待确认", async (t) => {
  const env = await workspace(t),
    { work, library, locks, clock } = env;
  await chapter.saveChapter(
    work,
    { chapterId: "ch-1", body: "林川左臂受伤。林川听懂了密道，来到新渡口。铜哨的谜团终于解开。" },
    locks,
  );
  await library.apply(
    work,
    [
      {
        type: "entity.upsert",
        entity: {
          id: "ent-1",
          name: "林川",
          kind: "character",
          aliases: [],
          summary: "",
          locked: [],
          provenance,
          rev: 0,
        },
      },
      {
        type: "state.add",
        entry: {
          id: "st-plan",
          entity: "ent-1",
          facet: "condition",
          field: "伤势",
          value: "左臂受伤",
          since: 1,
          mode: "replace",
          status: "planned",
          provenance,
          rev: 0,
        },
      },
      {
        type: "thread.upsert",
        thread: {
          id: "th-1",
          title: "铜哨谜团",
          kind: "mystery",
          opened: 1,
          importance: "major",
          beats: [{ kind: "plant", chapter: 1, note: "铜哨" }],
          status: "open",
          provenance,
          rev: 0,
        },
      },
    ],
    0,
  );
  const deltas = [
    {
      kind: "state",
      targetId: "林川",
      name: "林川",
      field: "伤势",
      facet: "condition",
      value: "左臂受伤",
      detail: "左臂受伤",
      quote: "林川左臂受伤",
    },
    {
      kind: "knowledge",
      targetId: "林川",
      name: "林川",
      detail: "密道位置",
      level: "知情",
      quote: "林川听懂了密道",
    },
    {
      kind: "thread",
      targetId: "th-1",
      name: "铜哨谜团",
      detail: "谜团解开",
      beat: "pay",
      quote: "铜哨的谜团终于解开",
    },
    {
      kind: "entity",
      entityKind: "place",
      targetId: "new-place",
      name: "新渡口",
      detail: "新渡口",
      quote: "来到新渡口",
    },
  ];
  const port = createFakeModelPort([{ text: JSON.stringify({ deltas }) }]),
    gateway = createModelGateway(
      port,
      {
        globalConcurrency: 2,
        perRunConcurrency: 1,
        roles: { extractor: { connection: "fake", model: "fake" } },
      },
      clock,
    ),
    ctx = await ledgerPipeline.context({ mode: "fanqie", path: work }, { chapterId: "ch-1" });
  const record = await runPipeline(ledgerPipeline, ctx, gateway, clock);
  assert.equal(record.state, "awaiting-author");
  assert.equal((await library.read(work)).threads[0].status, "open");
  const [batch] = await library.readPendingBatches(work),
    state = batch.items.find((item) => item.op.type === "state.add"),
    knowledge = batch.items.find((item) => item.op.type === "knowledge.set"),
    place = batch.items.find((item) => item.op.type === "entity.upsert");
  assert.equal(state.change, "fulfill");
  assert.equal(state.op.entry.status, "confirmed");
  assert.equal(knowledge.op.row.holder, "ent-1");
  assert.equal(place.op.entity.kind, "place");
  assert.ok(batch.items.every((item) => item.decision === "undecided"));
  await library.decide(
    work,
    batch.id,
    batch.items.map((item) => ({ id: item.id, decision: "accept" })),
  );
  const result = await library.commit(work, batch.id, (await bible.readBibleIndex(work)).files);
  assert.equal(result.committed, 5);
  const snapshot = await library.read(work);
  assert.equal(snapshot.states[0].id, "st-plan");
  assert.equal(snapshot.states[0].status, "confirmed");
  assert.equal(snapshot.threads[0].status, "paid");
  assert.deepEqual(
    snapshot.threads[0].beats.map((beat) => beat.kind),
    ["plant", "pay"],
  );
  assert.equal((await library.ledgers(work))[0].appearances[0].count, 2);
  await library.revert(work, result.changeId);
  assert.equal((await library.read(work)).states[0].status, "planned");
  assert.equal((await library.ledgers(work)).length, 0);
});

test("未知状态主体先提议新实体；未见计划回收与新实体出场都记入台账", async (t) => {
  const env = await workspace(t),
    { work, library, locks, clock } = env;
  await chapter.saveChapter(work, { chapterId: "ch-plan", body: "阿珂提起旧刀。" }, locks);
  await library.apply(
    work,
    [
      {
        type: "thread.upsert",
        thread: {
          id: "th-plan-pay",
          title: "旧刀之谜",
          kind: "mystery",
          opened: 1,
          plannedPayoff: 1,
          importance: "major",
          beats: [{ chapter: 1, kind: "plant", note: "旧刀" }],
          status: "open",
          provenance,
          rev: 0,
        },
      },
    ],
    0,
  );
  const { ops } = treeOps(1, 1, 1),
    plan = ops.find((op) => op.type === "node.create" && op.level === "chapter");
  plan.node.chapterId = "ch-plan";
  plan.node.pay = [{ thread: "th-plan-pay" }];
  await env.store.apply(work, ops);
  const deltas = [
      {
        kind: "state",
        targetId: "unknown-ake",
        name: "阿珂",
        field: "伤势",
        facet: "condition",
        value: "左手受伤",
        detail: "左手受伤",
        entityKind: "character",
        quote: "阿珂提起旧刀",
      },
    ],
    port = createFakeModelPort([{ text: JSON.stringify({ deltas }) }]),
    gateway = createModelGateway(
      port,
      {
        globalConcurrency: 2,
        perRunConcurrency: 1,
        roles: { extractor: { connection: "fake", model: "fake" } },
      },
      clock,
    ),
    ctx = await ledgerPipeline.context({ mode: "fanqie", path: work }, { chapterId: "ch-plan" }),
    run = await runPipeline(ledgerPipeline, ctx, gateway, clock);
  assert.equal(run.state, "awaiting-author");
  const batch = (await library.readPendingBatches(work))[0],
    entity = batch.items.find((item) => item.op.type === "entity.upsert"),
    state = batch.items.find((item) => item.op.type === "state.add"),
    ledger = batch.items.find((item) => item.op.type === "ledger.write");
  assert.ok(entity);
  assert.equal(state.op.entry.entity, entity.op.entity.id);
  assert.ok(state.dependsOn.includes(entity.id));
  assert.equal(
    ledger.op.entry.appearances.find((item) => item.entity === entity.op.entity.id)?.count,
    1,
  );
  assert.ok(ledger.op.entry.handoff.openQuestions.some((note) => note.includes("旧刀之谜")));
});
for (const mode of ["auto", "ask", "off"])
  test(`定稿后 ledger=${mode} → ${mode === "auto" ? "发起待确认记账" : "保留作者手动控制"}`, async (t) => {
    const env = await workspace(t);
    await updateWorkSettings(
      env.work,
      { ledger: mode, grade: "premium", profile: "default" },
      env.locks,
    );
    let called = 0,
      started;
    const signal = new Promise((resolve) => (started = resolve));
    await afterFinalize(
      {
        inside: (x) => x,
        locks: env.locks,
        clock: env.clock,
        workflow: {
          startAndWait: async (target, kind, request) => {
            called++;
            assert.equal(kind, "fanqie.ledger");
            assert.equal(request.trigger, "auto");
            started();
            return { state: "awaiting-author" };
          },
        },
      },
      env.work,
      "ch-1",
    );
    if (mode === "auto") await signal;
    assert.equal(called, mode === "auto" ? 1 : 0);
  });

test("自动记账遇到运行中的任务会排队，空闲后按序启动", async (t) => {
  const env = await workspace(t),
    { work, base, locks, clock } = env;
  await chapter.saveChapter(work, { chapterId: "ch-queue", body: "林川回到渡口。" }, locks);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  let markEntered;
  const entered = new Promise((resolve) => (markEntered = resolve));
  const port = createFakeModelPort(
      async (_request, _signal, _on, call) => {
        if (call === 1) {
          markEntered();
          await gate;
        }
        return { text: JSON.stringify({ deltas: [] }) };
      },
      { repeatLast: true },
    ),
    gateway = desk.createModelGateway(
      port,
      {
        globalConcurrency: 2,
        perRunConcurrency: 1,
        roles: { extractor: { connection: "fake", model: "fake" } },
      },
      clock,
    ),
    runs = desk.createRunStore(path.join(base, "runs")),
    workflow = desk.createWorkflowService({
      clock,
      runs,
      gateway: () => gateway,
      budget: () => ({ inputBudget: 200000, runBudget: 10000000, moneyCap: null }),
      profileRoots: () => ({ builtinDir: path.resolve("packages/fanqie/profiles") }),
      profileId: async () => "default",
      emit: () => undefined,
    }),
    target = { mode: "fanqie", path: work };
  t.after(() => workflow.stopAll());
  const first = await workflow.start(target, "fanqie.ledger", { chapterId: "ch-queue" });
  await entered;
  const queued = workflow.enqueueAndWait(target, "fanqie.ledger", { chapterId: "ch-queue" });
  assert.equal(port.calls.length, 1);
  release();
  const second = await queued;
  assert.equal((await workflow.get(first)).state, "awaiting-author");
  assert.equal(second.state, "awaiting-author");
  assert.equal(port.calls.length, 2);
  assert.equal((await workflow.history(target)).length, 2);
});
