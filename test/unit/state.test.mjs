import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { TRANSITIONS, transition } = await importTs("packages/core/src/pipeline/state.ts");
const { isAppError } = await importTs("packages/core/src/errors/index.ts");

function makeRecord(state = "running") {
  return {
    state,
    stateHistory: [{ to: state, reason: "start", at: "2026-11-15T00:00:00.000Z" }],
    updated: "2026-11-15T00:00:00.000Z",
  };
}

test("TRANSITIONS allows valid lifecycle paths and records stateHistory", () => {
  let rec = makeRecord("running");
  rec = transition(rec, "paused", "budget", "2026-11-15T00:01:00.000Z", "draft");
  assert.equal(rec.state, "paused");
  assert.equal(rec.updated, "2026-11-15T00:01:00.000Z");
  assert.equal(rec.stateHistory.length, 2);
  assert.deepEqual(rec.stateHistory[1], {
    to: "paused",
    reason: "budget",
    stage: "draft",
    at: "2026-11-15T00:01:00.000Z",
  });

  rec = transition(rec, "running", "resume", "2026-11-15T00:02:00.000Z");
  rec = transition(rec, "awaiting-author", "deliver", "2026-11-15T00:03:00.000Z");
  rec = transition(rec, "applied", "apply", "2026-11-15T00:04:00.000Z");
  assert.equal(rec.state, "applied");
  assert.deepEqual(TRANSITIONS.applied, []);
});

test("transition rejects invalid state changes with run.invalid_transition", () => {
  const paused = makeRecord("paused");
  assert.throws(
    () => transition(paused, "awaiting-author", "deliver", "2026-11-15T00:01:00.000Z"),
    (err) => isAppError(err, "run.invalid_transition"),
  );

  for (const terminal of ["applied", "discarded", "cancelled"]) {
    const rec = makeRecord(terminal);
    assert.throws(
      () => transition(rec, "running", "retry", "2026-11-15T00:01:00.000Z"),
      (err) => isAppError(err, "run.invalid_transition"),
    );
  }
});
