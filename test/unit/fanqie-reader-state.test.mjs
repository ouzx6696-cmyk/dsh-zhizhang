import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { bodyKey, initialState, reducer } = await importTs(
  "packages/workbench/src/client/fanqie/state.ts",
);

const row = (revision) => ({
  id: "ch-001",
  title: "雨夜",
  position: 1,
  status: "drafting",
  wordCount: 10,
  revision,
});

function snapshot(state, revision, rowRevision, full = false, work = "works/夜航") {
  return reducer(state, {
    type: "snapshot",
    work,
    delta: { revision, full, rows: [row(rowRevision)], removedIds: [] },
  });
}

function readyState() {
  let state = reducer(initialState(), { type: "selectWork", work: "works/夜航" });
  state = snapshot(state, "s1", "rev-a", true);
  state = reducer(state, { type: "selectChapter", id: "ch-001" });
  const key = bodyKey(state);
  return reducer(state, {
    type: "body",
    value: { key, status: "ready", body: "正文", title: "雨夜", revision: "rev-a" },
  });
}

test("D3: a background refresh does not kick the author out of the editor", () => {
  let state = reducer(readyState(), { type: "edit", value: true });
  const before = bodyKey(state);
  state = snapshot(state, "s2", "rev-b");
  assert.equal(state.edit, true);
  assert.equal(state.chapter.status, "ready");
  assert.equal(bodyKey(state), before);
  state = reducer(state, { type: "reloadBodies" });
  assert.equal(state.chapter.status, "ready");
  assert.equal(state.chapter.body, "正文");
});

test("D3: leaving the editor re-keys the body to the newer revision", () => {
  let state = reducer(readyState(), { type: "edit", value: true });
  state = snapshot(state, "s2", "rev-b");
  const editing = bodyKey(state);
  state = reducer(state, { type: "edit", value: false });
  assert.notEqual(bodyKey(state), editing);
});

test("D3: while reading, only a revision change of the current chapter reloads the body", () => {
  let state = readyState();
  const key = bodyKey(state);
  state = snapshot(state, "s2", "rev-a");
  assert.equal(bodyKey(state), key);
  assert.equal(state.chapter.status, "ready");
  state = snapshot(state, "s3", "rev-b");
  assert.notEqual(bodyKey(state), key);
  assert.equal(state.chapter.status, "idle");
});

test("DEF-01: 换作品后，旧 selection 时期发出的新作品快照仍被采纳，列表不再卡在 boot", () => {
  let state = reducer(initialState(), { type: "selectWork", work: "works/夜航" });
  state = snapshot(state, "s1", "rev-a", true);
  // 切到灯塔：selectWork 先生效，随后才收到在切换前发出的快照响应（携带旧 selection）。
  state = reducer(state, { type: "selectWork", work: "works/灯塔" });
  assert.equal(state.phase, "boot");
  state = reducer(state, {
    type: "snapshot",
    work: "works/灯塔",
    delta: { revision: "t1", full: true, rows: [{ ...row("rev-t"), id: "ch-t1" }], removedIds: [] },
  });
  assert.equal(state.phase, "ready");
  assert.equal(state.work, "works/灯塔");
  assert.equal(state.rowSnapshot.rows.length, 1);
});

test("DEF-01: 迟到的旧作品快照按作品丢弃，不污染当前列表", () => {
  let state = reducer(initialState(), { type: "selectWork", work: "works/夜航" });
  state = snapshot(state, "s1", "rev-a", true);
  state = reducer(state, { type: "selectWork", work: "works/灯塔" });
  const before = state;
  state = reducer(state, {
    type: "snapshot",
    work: "works/夜航",
    delta: { revision: "s9", full: true, rows: [{ ...row("rev-b"), id: "ch-x" }], removedIds: [] },
  });
  assert.equal(state, before);
});
