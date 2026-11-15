import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { atomicWrite, sha256 } = await importTs("packages/core/src/fs/index.ts");
const { commitIntent, replayIntents, verifyBeforeHash } = await importTs(
  "packages/core/src/journal/index.ts",
);
const { createLockService } = await importTs("packages/core/src/lock/index.ts");

test("atomicWrite writes file cleanly without leaving tmp files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-atomic-"));
  try {
    const target = path.join(dir, "nested", "chapter.md");
    await atomicWrite(target, "第一章内容");
    assert.equal(await fs.readFile(target, "utf8"), "第一章内容");

    const entries = await fs.readdir(path.dirname(target));
    assert.deepEqual(entries, ["chapter.md"]);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("commitIntent writes targets and cleans up intent journal", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-intent-"));
  try {
    const lock = createLockService(createFakeClock());
    const journalDir = path.join(dir, "journal");
    const target = path.join(dir, "ch01.md");
    await atomicWrite(target, "v1");
    const beforeHash = sha256("v1");
    assert.equal(await verifyBeforeHash(target, beforeHash), true);

    await commitIntent(
      journalDir,
      {
        format: "zhizhang/1.3",
        id: "intent-1",
        writes: [{ path: target, beforeHash, after: "v2" }],
        meta: { op: "save" },
      },
      lock,
      { kind: "work", path: dir },
    );

    assert.equal(await fs.readFile(target, "utf8"), "v2");
    assert.deepEqual(await fs.readdir(journalDir), []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("replayIntents resumes safe intents and flags externally modified conflicts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-replay-"));
  try {
    const journalDir = path.join(dir, "journal");
    await fs.mkdir(journalDir, { recursive: true });

    const safeFile = path.join(dir, "safe.md");
    await atomicWrite(safeFile, "old");
    await atomicWrite(
      path.join(journalDir, "ok.json"),
      JSON.stringify({
        format: "zhizhang/1.3",
        id: "ok",
        writes: [{ path: safeFile, beforeHash: sha256("old"), after: "new" }],
        meta: {},
      }),
    );

    const conflictFile = path.join(dir, "conflict.md");
    await atomicWrite(conflictFile, "edited-externally");
    await atomicWrite(
      path.join(journalDir, "bad.json"),
      JSON.stringify({
        format: "zhizhang/1.3",
        id: "bad",
        writes: [{ path: conflictFile, beforeHash: sha256("original"), after: "new" }],
        meta: {},
      }),
    );

    const res = await replayIntents(journalDir);
    assert.deepEqual(res.resumed, ["ok"]);
    assert.deepEqual(res.conflicts, ["bad"]);
    assert.equal(await fs.readFile(safeFile, "utf8"), "new");
    assert.equal(await fs.readFile(conflictFile, "utf8"), "edited-externally");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
