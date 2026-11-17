import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { createBibleStore } = await importTs("packages/fanqie/src/bible/store.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { replayIntents } = await importTs("packages/core/src/journal/index.ts");
const { sha256 } = await importTs("packages/core/src/fs/index.ts");

const prov = { source: "author", at: "2026-11-17T00:00:00.000Z" };
const FILES = ["entities", "timeline", "states", "threads", "knowledge", "style"];

function entity(overrides = {}) {
  return {
    id: "ent-1",
    kind: "character",
    name: "林默",
    aliases: [],
    summary: "主角",
    locked: [],
    provenance: prov,
    rev: 0,
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    id: "st-1",
    entity: "ent-1",
    facet: "condition",
    field: "境界",
    value: "炼气",
    since: 12,
    mode: "replace",
    status: "confirmed",
    provenance: prov,
    rev: 0,
    ...overrides,
  };
}

function ledger() {
  return {
    format: "zhizhang/1.3",
    chapter: "ch-2",
    revision: "rev-2",
    position: 37,
    summary: "入藏经阁",
    handoff: { ending: "他走进藏经阁。", openQuestions: [], positions: {}, carried: [] },
    hook: "门后有人",
    emotion: "警觉",
    facts: [],
    appearances: [{ entity: "ent-1", count: 1 }],
    ledgerRun: "run-1",
    rev: 0,
  };
}

async function setup() {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-d02-"));
  const clock = createFakeClock();
  const store = createBibleStore(createLockService(clock), { clock });
  return { work, clock, store };
}

async function readIndexFile(work) {
  return JSON.parse(await fs.readFile(path.join(work, "bible", "index.json"), "utf8"));
}

async function indexRev(work) {
  return Math.max(...Object.values((await readIndexFile(work)).files).map((file) => file.rev));
}

async function snapshot(work) {
  const out = {};
  for (const name of FILES) {
    out[name] = await fs
      .readFile(path.join(work, "bible", `${name}.json`), "utf8")
      .catch(() => null);
  }
  const ledgerFile = path.join(work, "bible", "ledger", "ch-2.json");
  out.ledger = await fs.readFile(ledgerFile, "utf8").catch(() => null);
  return out;
}

test("apply → revert：真源字节还原，index 只递增 rev；撤销的撤销回到撤销前", async () => {
  const { work, store } = await setup();
  try {
    await store.apply(
      work,
      [
        { type: "entity.upsert", entity: entity() },
        { type: "state.add", entry: state() },
      ],
      0,
    );
    const beforeSecond = await snapshot(work);
    const indexBeforeSecond = await readIndexFile(work);

    const second = await store.apply(
      work,
      [
        { type: "entity.upsert", entity: entity({ name: "林默（改）" }), expectedRev: 0 },
        { type: "state.add", entry: state({ id: "st-2", value: "筑基", since: 37 }) },
        { type: "ledger.write", entry: ledger() },
      ],
      await indexRev(work),
    );
    const afterSecond = await snapshot(work);
    assert.notEqual(afterSecond.states, beforeSecond.states);
    assert.notEqual(afterSecond.ledger, null);
    const indexBeforeRevert = await readIndexFile(work);

    const reverted = await store.revert(work, second.changeId, false);
    assert.equal(reverted.skipped.length, 0);
    assert.equal(reverted.changeIds.length, 1);
    const afterRevert = await snapshot(work);
    for (const name of FILES) {
      assert.equal(afterRevert[name], beforeSecond[name], `${name} 应逐字节还原`);
    }
    assert.equal(afterRevert.ledger, null, "新建的 ledger 文件应被删除");
    const indexAfterRevert = await readIndexFile(work);
    for (const name of FILES) {
      assert.equal(
        indexAfterRevert.files[name].hash,
        indexBeforeSecond.files[name].hash,
        `${name} 的索引 hash 应回到撤销前`,
      );
      assert.ok(
        indexAfterRevert.files[name].rev > indexBeforeRevert.files[name].rev,
        `${name} 的索引 rev 应单调递增`,
      );
    }

    const reReverted = await store.revert(work, reverted.changeIds[0], false);
    assert.equal(reReverted.changeIds.length, 1);
    const afterReRevert = await snapshot(work);
    for (const name of FILES) {
      assert.equal(afterReRevert[name], afterSecond[name], `${name} 应回到撤销前`);
    }
    assert.equal(afterReRevert.ledger, afterSecond.ledger);

    const changes = await store.changes(work, undefined, 10);
    assert.equal(changes[0].kind, "revert");
    assert.equal(
      changes.some((change) => change.kind === "apply"),
      true,
    );
    assert.equal("ops" in changes[0], false);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("提交后条目又被改 → revert 跳过并给 rev_changed；force 可强制撤销", async () => {
  const { work, store } = await setup();
  try {
    await store.apply(work, [{ type: "entity.upsert", entity: entity() }], 0);
    const first = await store.apply(
      work,
      [
        {
          type: "entity.upsert",
          entity: entity({ name: "第一改" }),
          expectedRev: 0,
        },
      ],
      await indexRev(work),
    );
    await store.apply(
      work,
      [
        {
          type: "entity.upsert",
          entity: entity({ name: "第二改" }),
          expectedRev: 1,
        },
      ],
      await indexRev(work),
    );

    const skipped = await store.revert(work, first.changeId, false);
    assert.deepEqual(skipped.changeIds, []);
    assert.deepEqual(skipped.skipped, [{ target: "ent-1", reason: "rev_changed" }]);

    const forced = await store.revert(work, first.changeId, true);
    assert.equal(forced.changeIds.length, 1);
    assert.deepEqual(forced.skipped, []);
    assert.equal((await store.read(work)).entities[0].name, "林默");
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("同一变更集多次改同一记录 → 撤销逐步回到变更前，不残留中间态", async () => {
  const { work, store } = await setup();
  try {
    const applied = await store.apply(
      work,
      [
        { type: "entity.upsert", entity: entity({ name: "第一版" }) },
        { type: "entity.upsert", entity: entity({ name: "第二版" }) },
      ],
      0,
    );
    assert.equal((await store.read(work)).entities[0].name, "第二版");

    const reverted = await store.revert(work, applied.changeId, false);
    assert.deepEqual(reverted.skipped, []);
    assert.deepEqual((await store.read(work)).entities, []);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("decide 设置 effectiveFrom → 提交时覆盖状态生效章", async () => {
  const { work, store, clock } = await setup();
  try {
    await store.apply(work, [{ type: "entity.upsert", entity: entity() }], 0);
    const pending = await store.propose(
      work,
      [{ type: "state.add", entry: state({ id: "st-eff", since: 1 }) }],
      { source: "author", at: clock.iso() },
    );
    const [batch] = await store.readPendingBatches(work);
    await store.decide(work, batch.id, [
      { id: pending[0].id, decision: "accept", effectiveFrom: 7 },
    ]);
    assert.equal((await store.commit(work, batch.id, {})).committed, 1);
    assert.equal((await store.read(work)).states[0].since, 7);
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("同批次待建实体/记录 → 自动 dependsOn 并按其顺序提交", async () => {
  const { work, store, clock } = await setup();
  try {
    const pending = await store.propose(
      work,
      [
        {
          type: "state.update",
          id: "st-new",
          patch: { value: "改后" },
          expectedRev: 0,
        },
        {
          type: "state.add",
          entry: state({ id: "st-new", entity: "ent-new", value: "初始", since: 1 }),
        },
        {
          type: "entity.upsert",
          entity: entity({ id: "ent-new", name: "新人" }),
        },
      ],
      { source: "author", at: clock.iso() },
    );
    assert.deepEqual(pending[0].dependsOn, [pending[1].id]);
    assert.deepEqual(pending[1].dependsOn, [pending[2].id]);
    assert.deepEqual(pending[2].dependsOn, []);

    const [batch] = await store.readPendingBatches(work);
    await store.decide(
      work,
      batch.id,
      pending.map((item) => ({ id: item.id, decision: "accept" })),
    );
    const result = await store.commit(work, batch.id, {});
    assert.equal(result.committed, 3);
    const [updated] = (await store.read(work)).states;
    assert.equal(updated.value, "改后");
    assert.equal(updated.since, 1);
    assert.equal(updated.until, undefined);
    assert.equal(updated.status, "confirmed");
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("批次分两次提交 → 已提交的 new 条目进 stale，不重复写入", async () => {
  const { work, store, clock } = await setup();
  try {
    const pending = await store.propose(
      work,
      [
        { type: "entity.upsert", entity: entity({ name: "甲" }) },
        { type: "entity.upsert", entity: entity({ id: "ent-2", name: "乙" }) },
      ],
      { source: "author", at: clock.iso() },
    );
    const [batch] = await store.readPendingBatches(work);

    await store.decide(work, batch.id, [{ id: pending[0].id, decision: "accept" }]);
    assert.equal((await store.commit(work, batch.id, {})).committed, 1);
    await store.decide(work, batch.id, [{ id: pending[1].id, decision: "accept" }]);

    const second = await store.commit(work, batch.id, {});
    assert.equal(second.committed, 1);
    assert.deepEqual(second.stale, [pending[0].id]);
    const bible = await store.read(work);
    assert.deepEqual(
      bible.entities.map((item) => [item.id, item.name, item.rev]),
      [
        ["ent-1", "甲", 0],
        ["ent-2", "乙", 0],
      ],
    );

    const third = await store.commit(work, batch.id, {});
    assert.equal(third.committed, 0);
    assert.deepEqual(third.stale, [pending[0].id, pending[1].id]);
    assert.deepEqual(
      (await store.read(work)).entities.map((item) => item.rev),
      [0, 0],
    );
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("批次提交：baseRev 变化的条目进 stale，其余照常提交", async () => {
  const { work, store, clock } = await setup();
  try {
    await store.apply(
      work,
      [
        { type: "entity.upsert", entity: entity() },
        { type: "state.add", entry: state() },
      ],
      0,
    );
    const pending = await store.propose(
      work,
      [
        {
          type: "state.update",
          id: "st-1",
          patch: { value: "过期值" },
          expectedRev: 0,
        },
        {
          type: "entity.upsert",
          entity: entity({ id: "ent-2", name: "新人" }),
        },
      ],
      { source: "author", at: clock.iso() },
    );
    const [batch] = await store.readPendingBatches(work);
    await store.decide(
      work,
      batch.id,
      pending.map((item) => ({ id: item.id, decision: "accept" })),
    );
    await store.apply(
      work,
      [
        {
          type: "state.update",
          id: "st-1",
          patch: { value: "当前值" },
          expectedRev: 0,
        },
      ],
      await indexRev(work),
    );

    const result = await store.commit(work, batch.id, {});
    assert.equal(result.committed, 1);
    assert.equal(result.stale.length, 1);
    const bible = await store.read(work);
    assert.equal(bible.states[0].value, "当前值");
    assert.equal(
      bible.entities.some((item) => item.id === "ent-2"),
      true,
    );
  } finally {
    await fs.rm(work, { recursive: true, force: true });
  }
});

test("Intent 中途崩溃 → replay 把同一 Intent 的全部写入补齐", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-d02-intent-"));
  try {
    const journal = path.join(dir, ".journal");
    await fs.mkdir(journal, { recursive: true });
    const a = path.join(dir, "a.json");
    const b = path.join(dir, "b.json");
    await fs.writeFile(a, "a0");
    await fs.writeFile(b, "b0");
    const intent = {
      format: "zhizhang/1.3",
      id: "cs-test",
      writes: [
        { path: a, beforeHash: sha256("a0"), after: "a1" },
        { path: b, beforeHash: sha256("b0"), after: "b1" },
      ],
      meta: { kind: "apply" },
    };
    await fs.writeFile(path.join(journal, "cs-test.json"), JSON.stringify(intent));
    await fs.writeFile(a, "a1");
    const result = await replayIntents(journal);
    assert.deepEqual(result.conflicts, []);
    assert.equal(await fs.readFile(a, "utf8"), "a1");
    assert.equal(await fs.readFile(b, "utf8"), "b1");
    assert.deepEqual(await fs.readdir(journal), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
