import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { isAppError } = await importTs("packages/core/src/errors/index.ts");
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
        format: "zhizhang/2.0",
        id: "intent-1",
        writes: [{ path: target, beforeHash, after: "v2" }],
        meta: { op: "save" },
      },
      lock,
      { kind: "work", path: dir },
    );

    assert.equal(await fs.readFile(target, "utf8"), "v2");
    assert.deepEqual(await fs.readdir(journalDir), []);

    // 目标文件已被修改时 commitIntent 必须抛出 storage.conflict 且不覆写
    await assert.rejects(
      () =>
        commitIntent(
          journalDir,
          {
            format: "zhizhang/2.0",
            id: "intent-stale",
            writes: [{ path: target, beforeHash, after: "v3-stale" }],
            meta: { op: "save" },
          },
          lock,
          { kind: "work", path: dir },
        ),
      (err) => isAppError(err, "storage.conflict"),
    );
    assert.equal(await fs.readFile(target, "utf8"), "v2");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("replayIntents resumes safe intents, flags conflicts, and blocks sandbox escape", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-replay-"));
  const outsideFile = path.join(os.tmpdir(), `zz-escape-${Date.now()}.md`);
  try {
    const lock = createLockService(createFakeClock());
    const journalDir = path.join(dir, "journal");
    await fs.mkdir(journalDir, { recursive: true });

    const safeFile = path.join(dir, "safe.md");
    await atomicWrite(safeFile, "old");
    await atomicWrite(
      path.join(journalDir, "ok.json"),
      JSON.stringify({
        format: "zhizhang/2.0",
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
        format: "zhizhang/2.0",
        id: "bad",
        writes: [{ path: conflictFile, beforeHash: sha256("original"), after: "new" }],
        meta: {},
      }),
    );

    await atomicWrite(
      path.join(journalDir, "escape.json"),
      JSON.stringify({
        format: "zhizhang/2.0",
        id: "escape",
        writes: [{ path: outsideFile, beforeHash: null, after: "pwned" }],
        meta: {},
      }),
    );

    const res = await replayIntents(journalDir, {
      allowedRoots: [dir],
      lock,
      resource: { kind: "work", path: dir },
    });
    assert.deepEqual(res.resumed, ["ok"]);
    assert.deepEqual(res.conflicts.sort(), ["bad", "escape"]);
    assert.equal(await fs.readFile(safeFile, "utf8"), "new");
    assert.equal(await fs.readFile(conflictFile, "utf8"), "edited-externally");
    await assert.rejects(() => fs.access(outsideFile));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outsideFile, { force: true });
  }
});
