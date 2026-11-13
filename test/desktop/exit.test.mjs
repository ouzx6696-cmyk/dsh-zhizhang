import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { access, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Diagnostics } from "../../apps/desktop/out-test/diagnostics.mjs";

const effects = () => import("../../apps/desktop/out-test/runtime-effects.mjs");
const LOCK = ".writer-workspace-lock.json";
const exists = (file) =>
  access(file).then(
    () => true,
    (error) => {
      if (error.code === "ENOENT") return false;
      throw error;
    },
  );

/** What Electron hands a listener: preventDefault is the only thing listeners act through. */
function electronEvent() {
  return {
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

async function quitFixture() {
  const { Runtime, app, claimWorkspace, registerQuitCleanup } = await effects();
  app.removeAllListeners();
  app.quits = 0;
  const home = await realpath(await mkdtemp(path.join(tmpdir(), "writer-quit-")));
  await claimWorkspace(home);
  const state = new Runtime();
  state.diagnostics = new Diagnostics(home);
  const disposed = [];
  state.sessions = { dispose: async () => disposed.push("sessions") };
  registerQuitCleanup(state);
  return { app, home, state, disposed, lock: path.join(home, LOCK) };
}

/** Lets will-quit's async cleanup run to its app.quit(). */
async function settle(app, quits) {
  for (let i = 0; i < 100 && app.quits < quits; i++)
    await new Promise((resolve) => setTimeout(resolve, 10));
}

test("退出被窗口取消时会话与作品占用保持完整", async () => {
  const { app, home, disposed, lock } = await quitFixture();
  try {
    // Electron fires before-quit first; a renderer that vetoes unloading cancels the quit there
    // and will-quit never comes.
    app.emit("before-quit", electronEvent());
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(disposed, []);
    assert.equal(await exists(lock), true);
    assert.equal(app.quits, 0);
  } finally {
    await (await effects()).releaseWorkspace(home);
    await rm(home, { recursive: true, force: true });
  }
});

test("will-quit 先完成会话销毁与占用释放再退出，第二次放行", async () => {
  const { app, home, disposed, lock } = await quitFixture();
  try {
    const first = electronEvent();
    app.emit("will-quit", first);
    assert.equal(first.defaultPrevented, true);
    await settle(app, 1);
    assert.deepEqual(disposed, ["sessions"]);
    assert.equal(await exists(lock), false);
    assert.equal(app.quits, 1);
    const second = electronEvent();
    app.emit("will-quit", second);
    assert.equal(second.defaultPrevented, false);
    assert.deepEqual(disposed, ["sessions"]);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("退出清理失败写诊断日志，仍释放占用并退出", async () => {
  const { app, home, state, lock } = await quitFixture();
  state.sessions = {
    dispose: async () => {
      throw new Error("会话收尾超时");
    },
  };
  try {
    app.emit("will-quit", electronEvent());
    await settle(app, 1);
    assert.equal(app.quits, 1);
    assert.equal(await exists(lock), false);
    const log = await readFile(
      path.join(home, "logs", new Date().toISOString().slice(0, 10) + ".jsonl"),
      "utf8",
    );
    const entry = JSON.parse(log.trim().split("\n").at(-1));
    assert.equal(entry.event, "quit_cleanup_failed");
    assert.equal(entry.step, "sessions");
    assert.equal(entry.error, "会话收尾超时");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("退出取消运行中的备份进程，取消原因保持 CANCELLED", async () => {
  const { runBackup } = await effects();
  const { app, home, state } = await quitFixture();
  try {
    const script = path.join(home, "waiting.mjs");
    await writeFile(script, "setTimeout(() => {}, 30000);");
    const cancelled = assert.rejects(runBackup(script, [], state.background.signal), {
      code: "CANCELLED",
    });
    app.emit("will-quit", electronEvent());
    await cancelled;
    await settle(app, 1);
    assert.equal(state.background.signal.aborted, true);
    assert.equal(app.quits, 1);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("有未保存修改时关窗交给作者：留下保持窗口，离开放行卸载", async () => {
  const { dialog, guardUnload } = await effects();
  const asked = [];
  const window = { webContents: new EventEmitter() };
  guardUnload(window);
  for (const [answer, leaves] of [
    [0, false],
    [1, true],
  ]) {
    dialog.showMessageBoxSync = (parent, options) => {
      asked.push({ parent, options });
      return answer;
    };
    const event = electronEvent();
    window.webContents.emit("will-prevent-unload", event);
    // preventDefault on will-prevent-unload is what lets the page unload.
    assert.equal(event.defaultPrevented, leaves);
  }
  assert.equal(asked.length, 2);
  assert.equal(asked[0].parent, window);
  assert.deepEqual(asked[0].options.buttons, ["留下", "离开"]);
  assert.equal(asked[0].options.cancelId, 0);
  assert.equal(asked[0].options.defaultId, 0);
});
