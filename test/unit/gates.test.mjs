import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { assertWorkspaceWritable, assertInsideWorkspace } = await importTs(
  "packages/core/src/tool/gates.ts",
);
const { isAppError } = await importTs("packages/core/src/errors/index.ts");

test("assertWorkspaceWritable blocks readonly mode with storage.locked", () => {
  assert.doesNotThrow(() => assertWorkspaceWritable(false));
  assert.throws(
    () => assertWorkspaceWritable(true),
    (err) => isAppError(err, "storage.locked"),
  );
});

test("assertInsideWorkspace allows safe relative paths and rejects escapes/reserved/symlinks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-gate-"));
  try {
    const okPath = assertInsideWorkspace(root, "chapters/ch01.md");
    assert.equal(okPath, path.resolve(root, "chapters/ch01.md"));

    for (const bad of [
      "",
      "/etc/passwd",
      "../outside.txt",
      "sub/../../escape",
      "CON.txt",
      "dir/nul",
    ]) {
      assert.throws(
        () => assertInsideWorkspace(root, bad),
        (err) => isAppError(err, "input.invalid"),
        `Expected input.invalid for ${bad}`,
      );
    }

    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-out-"));
    try {
      await fs.symlink(outside, path.join(root, "link"));
      assert.throws(
        () => assertInsideWorkspace(root, "link/secret.txt"),
        (err) => isAppError(err, "input.invalid"),
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
