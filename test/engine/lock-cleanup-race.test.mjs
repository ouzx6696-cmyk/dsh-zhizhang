import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const childScript = `
import fs from 'node:fs/promises';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
const [role, root, module] = process.argv.slice(1);
const target = role === 'claim' ? path.join(root,'.writer-workspace-claim','owner.json') : path.join(root,'.writer-write-lock','owner.json');
if (role === 'claim' || role === 'clear') {
  const original = fs.unlink; let paused = false;
  fs.unlink = async (file, ...args) => {
    if (!paused && file === target) {
      paused = true; process.send({type:'paused'});
      await new Promise(resolve => process.once('message', resolve));
    }
    return original(file, ...args);
  };
  syncBuiltinESMExports();
}
const api = await import(module);
if (role === 'claim' || role === 'other') {
  process.send({type:'started'});
  const access = await api.claimWorkspace(root);
  process.send({type:'claimed', readOnly:access.readOnly});
  await new Promise(resolve => process.once('message', resolve));
} else if (role === 'clear') {
  await api.clearWriteLock(root);
  process.send({type:'cleared'});
} else {
  process.send({type:'started'});
  await api.withResourceLock(root, async () => {
    process.send({type:'inside'});
    await new Promise(resolve => process.once('message', resolve));
  });
}
`;

function start(role, root, file) {
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", childScript, role, root, pathToFileURL(file).href],
    {
      stdio: ["ignore", "ignore", "inherit", "ipc"],
    },
  );
  const messages = [];
  const waiters = [];
  child.on("message", (message) => {
    const index = waiters.findIndex((w) => w.type === message.type);
    if (index < 0) messages.push(message);
    else waiters.splice(index, 1)[0].resolve(message);
  });
  return {
    child,
    wait(type) {
      const index = messages.findIndex((m) => m.type === type);
      return index >= 0
        ? Promise.resolve(messages.splice(index, 1)[0])
        : new Promise((resolve) => waiters.push({ type, resolve }));
    },
  };
}

async function ensureWaiting(promise) {
  assert.equal(
    await Promise.race([
      promise.then(() => false),
      new Promise((resolve) => setTimeout(() => resolve(true), 150)),
    ]),
    true,
  );
}

test("清理旧认领和旧写锁时，新进程须等清理完成", { timeout: 15000 }, async (t) => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "writer-lock-transition-")));
  const children = [];
  t.after(async () => {
    for (const c of children) if (c.child.exitCode === null) c.child.kill();
    await rm(root, { recursive: true, force: true });
  });
  const launch = (role, file) => {
    const c = start(role, root, path.resolve(file));
    children.push(c);
    return c;
  };
  await mkdir(path.join(root, ".writer-workspace-claim"));
  await writeFile(
    path.join(root, ".writer-workspace-claim", "owner.json"),
    JSON.stringify({
      id: "stale",
      pid: 2147483647,
      machine: hostname(),
      host: "test",
      at: new Date().toISOString(),
    }),
  );
  const a = launch("claim", "build/core/src/workspace-lock.js");
  await a.wait("paused");
  const b = launch("other", "build/core/src/workspace-lock.js");
  await b.wait("started");
  const bClaim = b.wait("claimed");
  await ensureWaiting(bClaim);
  a.child.send("resume");
  assert.equal((await a.wait("claimed")).readOnly, false);
  assert.equal((await bClaim).readOnly, true);
  a.child.send("done");
  b.child.send("done");
  await Promise.all([a, b].map((c) => new Promise((resolve) => c.child.once("exit", resolve))));
  await rm(path.join(root, ".writer-workspace-lock.json"));
  await mkdir(path.join(root, ".writer-write-lock"));
  await writeFile(
    path.join(root, ".writer-write-lock", "owner.json"),
    JSON.stringify({
      id: "stale",
      pid: 2147483647,
      host: hostname(),
      createdAt: new Date().toISOString(),
    }),
  );
  const clear = launch("clear", "build/fanqie/src/engine/storage/process-lock.js");
  await clear.wait("paused");
  const writer = launch("writer", "build/fanqie/src/engine/storage/process-lock.js");
  await writer.wait("started");
  const entered = writer.wait("inside");
  await ensureWaiting(entered);
  clear.child.send("resume");
  await clear.wait("cleared");
  await entered;
  const { clearWriteLock } = await import("../../build/fanqie/src/engine/storage/process-lock.js");
  await assert.rejects(clearWriteLock(root), { code: "resource_lock_not_stale" });
  const writerExit = new Promise((resolve) => writer.child.once("exit", resolve));
  writer.child.send("done");
  await writerExit;
});
