import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { invertBibleOp } = await importTs("packages/fanqie/src/bible/invert.ts");
const { applyBibleOp, validateBible } = await importTs("packages/fanqie/src/bible/apply.ts");

const prov = { source: "author", at: "2026-11-17T00:00:00.000Z" };
const clone = (value) => structuredClone(value);

function entity(overrides = {}) {
  return {
    id: "ent-1",
    kind: "character",
    name: "林默",
    aliases: ["默哥"],
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
    since: 10,
    until: 20,
    mode: "replace",
    status: "confirmed",
    provenance: prov,
    rev: 0,
    ...overrides,
  };
}

function thread(overrides = {}) {
  return {
    id: "th-1",
    title: "玉佩",
    kind: "foreshadow",
    opened: 1,
    importance: "major",
    beats: [{ chapter: 1, kind: "plant", note: "初见" }],
    status: "open",
    provenance: prov,
    rev: 0,
    ...overrides,
  };
}

function ledger(chapter = "ch-1", overrides = {}) {
  return {
    format: "zhizhang/1.3",
    chapter,
    revision: "rev-1",
    position: 1,
    summary: "摘要",
    handoff: { ending: "结尾", openQuestions: [], positions: {}, carried: [] },
    hook: "钩子",
    emotion: "紧张",
    facts: [],
    appearances: [],
    ledgerRun: "run-1",
    rev: 0,
    ...overrides,
  };
}

function baseLib() {
  return {
    bible: {
      entities: [entity(), entity({ id: "ent-2", name: "旧名", aliases: [] })],
      timeline: [
        {
          id: "tl-1",
          title: "旧事",
          when: "十年前",
          order: 1,
          entities: ["ent-2"],
          summary: "旧事",
          canon: "backstory",
          provenance: prov,
          rev: 0,
        },
      ],
      states: [state()],
      threads: [thread()],
      knowledge: [
        {
          id: "kn-1",
          fact: "身世",
          holder: "ent-2",
          level: "不知",
          since: 1,
          provenance: prov,
          rev: 0,
        },
      ],
      style: { contract: "旧文风", rules: [], voiceSamples: [] },
    },
    ledgers: new Map([["ch-1", ledger()]]),
  };
}

function roundtrip(label, op) {
  const lib = baseLib();
  const before = clone(lib);
  const inverse = invertBibleOp(lib, op);
  assert.ok(inverse.length > 0, `${label}: 逆操作不得为空`);
  applyBibleOp(lib, op);
  for (const inv of inverse) {
    applyBibleOp(lib, inv, { restore: true, allowAnyIdDelete: true });
  }
  assert.deepEqual(lib, before, `${label}: 应用后撤销应字节还原`);
}

test("style.update 只应用已提供的字段，不抹掉其余文风", () => {
  const lib = baseLib();
  lib.bible.style.rules = [{ id: "r-1", condition: "打斗", change: "短句", why: "节奏" }];
  lib.bible.style.voiceSamples = ["旧样句"];
  applyBibleOp(lib, {
    type: "style.update",
    patch: { contract: "新文风", rules: undefined, voiceSamples: undefined },
  });
  assert.equal(lib.bible.style.contract, "新文风");
  assert.equal(lib.bible.style.rules.length, 1);
  assert.deepEqual(lib.bible.style.voiceSamples, ["旧样句"]);
});

test("entity.merge 改写 ledger 引用 → V2 通过，逆操作还原", () => {
  const lib = baseLib();
  lib.ledgers.set(
    "ch-1",
    ledger("ch-1", {
      appearances: [
        { entity: "ent-1", count: 1 },
        { entity: "ent-2", count: 2 },
      ],
      facts: [
        {
          id: "f-1",
          text: "两人同行",
          entities: ["ent-1", "ent-2"],
          kind: "event",
          quote: "同行",
          located: true,
        },
      ],
      handoff: {
        ending: "结尾",
        openQuestions: [],
        positions: { "ent-2": "旧城客栈" },
        carried: [],
      },
    }),
  );
  const before = clone(lib);
  const inverse = invertBibleOp(lib, { type: "entity.merge", keep: "ent-1", drop: "ent-2" });
  applyBibleOp(lib, { type: "entity.merge", keep: "ent-1", drop: "ent-2" });
  validateBible(lib);

  const entry = lib.ledgers.get("ch-1");
  assert.deepEqual(entry.appearances, [{ entity: "ent-1", count: 3 }]);
  assert.deepEqual(entry.facts[0].entities, ["ent-1"]);
  assert.deepEqual(entry.handoff.positions, { "ent-1": "旧城客栈" });
  assert.equal(entry.rev, 1);

  for (const op of inverse) applyBibleOp(lib, op, { restore: true, allowAnyIdDelete: true });
  assert.deepEqual(lib, before);
});

test("每个 BibleOp 类型都有逆操作并能还原真源", () => {
  roundtrip("entity.upsert 新建", {
    type: "entity.upsert",
    entity: entity({ id: "ent-new", name: "新人" }),
  });
  roundtrip("entity.upsert 更新", {
    type: "entity.upsert",
    entity: entity({ name: "改名" }),
    expectedRev: 0,
  });
  roundtrip("entity.merge", { type: "entity.merge", keep: "ent-1", drop: "ent-2" });
  roundtrip("entity.delete", { type: "entity.delete", id: "ent-2", expectedRev: 0 });
  roundtrip("timeline.upsert 新建", {
    type: "timeline.upsert",
    event: {
      id: "tl-new",
      title: "新事",
      when: "今年",
      order: 2,
      entities: [],
      summary: "新事",
      canon: "onstage",
      provenance: prov,
      rev: 0,
    },
  });
  roundtrip("timeline.upsert 更新", {
    type: "timeline.upsert",
    event: {
      id: "tl-1",
      title: "新标题",
      when: "十年前",
      order: 1,
      entities: ["ent-2"],
      summary: "旧事",
      canon: "backstory",
      provenance: prov,
      rev: 0,
    },
    expectedRev: 0,
  });
  roundtrip("state.add 新建", {
    type: "state.add",
    entry: state({ id: "st-new", since: 30, until: undefined }),
  });
  roundtrip("state.add 关闭旧区间", {
    type: "state.add",
    entry: state({ id: "st-new", value: "筑基", since: 15, until: undefined }),
  });
  roundtrip("state.update", {
    type: "state.update",
    id: "st-1",
    patch: { value: "筑基" },
    expectedRev: 0,
  });
  roundtrip("state.delete", { type: "state.delete", id: "st-1", expectedRev: 0 });
  roundtrip("thread.upsert 新建", {
    type: "thread.upsert",
    thread: thread({ id: "th-new", title: "新线" }),
  });
  roundtrip("thread.upsert 更新", {
    type: "thread.upsert",
    thread: thread({ status: "paid", beats: [{ chapter: 5, kind: "pay", note: "回收" }] }),
    expectedRev: 0,
  });
  roundtrip("thread.beat", {
    type: "thread.beat",
    thread: "th-1",
    beat: { chapter: 3, kind: "push", note: "推进" },
  });
  roundtrip("knowledge.set 新建", {
    type: "knowledge.set",
    row: {
      id: "kn-new",
      fact: "新事实",
      holder: "ent-1",
      level: "知情",
      since: 2,
      provenance: prov,
      rev: 0,
    },
  });
  roundtrip("knowledge.set 更新", {
    type: "knowledge.set",
    row: {
      id: "kn-1",
      fact: "身世",
      holder: "ent-2",
      level: "知情",
      since: 1,
      provenance: prov,
      rev: 0,
    },
    expectedRev: 0,
  });
  roundtrip("ledger.write 新建", {
    type: "ledger.write",
    entry: ledger("ch-2", { position: 2 }),
  });
  roundtrip("ledger.write 更新", {
    type: "ledger.write",
    entry: ledger("ch-1", { summary: "新摘要" }),
  });
  roundtrip("style.update", {
    type: "style.update",
    patch: { contract: "新文风" },
  });
});
