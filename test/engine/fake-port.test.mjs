import assert from "node:assert/strict";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";

test("createFakeClock supports deterministic advance and AbortSignal", async () => {
  const clock = createFakeClock(1000, { autoAdvance: false });
  assert.equal(clock.now(), 1000);

  let woke = false;
  const sleeping = clock.sleep(500).then(() => {
    woke = true;
  });
  await Promise.resolve();
  assert.equal(woke, false);

  clock.advance(500);
  await sleeping;
  assert.equal(woke, true);
  assert.equal(clock.now(), 1500);

  const ac = new AbortController();
  const aborted = clock.sleep(100, ac.signal);
  ac.abort();
  await assert.rejects(() => aborted, { name: "AbortError" });
});

test("createFakeModelPort streams scripted chunks, records calls, and honors AbortSignal", async () => {
  const port = createFakeModelPort([
    { chunks: ["第一段", "第二段"], usage: { input: 10, cachedInput: 2, output: 6 }, cost: 0.01 },
  ]);

  const events = [];
  const ac = new AbortController();
  const ans = await port.stream(
    { connection: "default", model: "test-model", system: "sys", user: "usr" },
    ac.signal,
    (e) => events.push(e),
  );

  assert.equal(port.calls.length, 1);
  assert.equal(ans.text, "第一段第二段");
  assert.deepEqual(events, [
    { type: "delta", text: "第一段" },
    { type: "delta", text: "第二段" },
    { type: "done" },
  ]);
  assert.equal(ans.cost, 0.01);

  ac.abort();
  await assert.rejects(
    () =>
      port.stream(
        { connection: "default", model: "test-model", system: "sys", user: "usr" },
        ac.signal,
        () => {},
      ),
    { name: "AbortError" },
  );
});
