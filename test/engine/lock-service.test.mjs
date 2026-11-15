import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { isAppError } = await importTs("packages/core/src/errors/index.ts");

test("LockService write lock supports re-entrancy and times out on contention", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-lock-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const resource = { kind: "work", path: path.join(dir, "novel") };

    const result = await lock.write(resource, async () => {
      return lock.write(resource, async () => "reentrant-ok");
    });
    assert.equal(result, "reentrant-ok");

    const lockDir = path.join(dir, ".zhizhang-lock-novel");
    await fs.mkdir(lockDir, { recursive: true });
    await assert.rejects(
      () => lock.write(resource, async () => "never", { wait: 150 }),
      (err) => isAppError(err, "storage.locked"),
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("LockService serializes tasks by key and isolates failures", async () => {
  const lock = createLockService(createFakeClock());
  const order = [];

  const p1 = lock
    .serial("work-1", async () => {
      order.push("1-start");
      await Promise.resolve();
      order.push("1-end");
      throw new Error("boom");
    })
    .catch(() => "caught");

  const p2 = lock.serial("work-1", async () => {
    order.push("2");
    return "ok";
  });

  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(r1, "caught");
  assert.equal(r2, "ok");
  assert.deepEqual(order, ["1-start", "1-end", "2"]);
});

test("LockService lease, inspectStale, and clearStale enforce author confirmation", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-stale-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);

    const lease = await lock.lease(dir);
    assert.equal(lease.root, dir);
    await lease.release();

    const staleDir = path.join(dir, ".zhizhang-lock-work");
    await fs.mkdir(staleDir, { recursive: true });
    await fs.writeFile(
      path.join(staleDir, "owner.json"),
      JSON.stringify({
        owner: `${os.hostname()}:999999`,
        pid: 999999,
        host: os.hostname(),
        acquiredAt: clock.iso(),
      }),
      "utf8",
    );

    const stale = await lock.inspectStale(dir);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].pid, 999999);

    await assert.rejects(
      () => lock.clearStale(stale[0], { confirmedByAuthor: false, at: clock.iso() }),
      (err) => isAppError(err, "gate.denied"),
    );

    await lock.clearStale(stale[0], { confirmedByAuthor: true, at: clock.iso() });
    assert.deepEqual(await lock.inspectStale(dir), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
