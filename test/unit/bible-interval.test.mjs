import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { planStateAdd, applyStatePlan, invertStatePlan } = await importTs(
  "packages/fanqie/src/bible/state.ts",
);
const { applyBibleOp } = await importTs("packages/fanqie/src/bible/apply.ts");

const prov = { source: "author", at: "2026-11-17T00:00:00.000Z" };

function state(overrides = {}) {
  return {
    id: "st-existing",
    entity: "ent-1",
    facet: "condition",
    field: "境界",
    value: "A",
    since: 10,
    until: 20,
    mode: "replace",
    status: "confirmed",
    provenance: prov,
    rev: 0,
    ...overrides,
  };
}

function incoming(overrides = {}) {
  return state({ id: "st-new", value: "B", ...overrides });
}

function expectCode(fn, code) {
  assert.throws(fn, (err) => {
    assert.equal(err.code, code);
    return true;
  });
}

test("state.add 区间：before / meets / during / finishes / after 均不重叠", () => {
  const before = planStateAdd([state()], incoming({ since: 1, until: 5 }));
  assert.equal(before.added, true);
  assert.deepEqual(before.changes, []);

  const meets = planStateAdd([state()], incoming({ since: 1, until: 10 }));
  assert.equal(meets.added, true);
  assert.deepEqual(meets.changes, []);

  const during = planStateAdd([state({ until: 30 })], incoming({ since: 15, until: 20 }));
  assert.equal(during.added, true);
  assert.equal(during.changes[0].after.until, 15);
  assert.deepEqual(during.entry, incoming({ since: 15, until: 20 }));

  const finishes = planStateAdd([state()], incoming({ since: 15, until: 30 }));
  assert.equal(finishes.added, true);
  assert.equal(finishes.changes[0].after.until, 15);

  const after = planStateAdd([state()], incoming({ since: 25, until: 30 }));
  assert.equal(after.added, true);
  assert.deepEqual(after.changes, []);
});

test("state.add 区间：同起点值不同 → 冲突，不新增条目", () => {
  expectCode(() => planStateAdd([state()], incoming({ since: 10, until: 30 })), "storage.conflict");
});

test("state.add 区间：重叠 confirmed 抛冲突，planned 让位并被截断", () => {
  expectCode(() => planStateAdd([state()], incoming({ since: 1, until: 15 })), "storage.conflict");

  const planned = planStateAdd(
    [state({ status: "planned", until: undefined })],
    incoming({ since: 1, until: 30 }),
  );
  assert.equal(planned.added, true);
  assert.equal(planned.entry.until, 10);
});

test("同位置 planned + confirmed 同值 → 兑现计划，不新增条目", () => {
  const planned = state({ status: "planned", since: 10, until: undefined });
  const plan = planStateAdd([planned], incoming({ since: 10, until: undefined, value: "A" }));
  assert.equal(plan.added, false);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].after.status, "confirmed");
  assert.equal(plan.changes[0].after.since, 10);
});

test("replace 生效关闭开放区间；逆操作按字节恢复原数组", () => {
  const original = [state({ since: 12, until: undefined, value: "外门柴房" })];
  const snapshot = JSON.parse(JSON.stringify(original));
  const plan = planStateAdd(original, incoming({ since: 37, until: undefined, value: "藏经阁" }));
  applyStatePlan(original, plan);
  assert.equal(original[0].until, 37);

  const lib = {
    bible: {
      entities: [],
      timeline: [],
      states: original,
      threads: [],
      knowledge: [],
      style: { contract: "", rules: [], voiceSamples: [] },
    },
    ledgers: new Map(),
  };
  for (const op of invertStatePlan(plan)) {
    applyBibleOp(lib, op, { restore: true, allowAnyIdDelete: true });
  }
  assert.equal(JSON.stringify(lib.bible.states), JSON.stringify(snapshot));
});
