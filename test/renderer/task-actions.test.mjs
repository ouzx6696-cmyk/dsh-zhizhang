import test from "node:test";
import assert from "node:assert/strict";
import { loadRenderer } from "../engine/helpers.mjs";
import { createRuntime } from "../engine/runtime.mjs";

function setup(mode, result) {
  const calls = [];
  const target = { mode, root: "/workspace", work: "book", article: "article" };
  const renderer = loadRenderer(createRuntime().react, {
    crypto: { randomUUID: () => "request-id" },
    window: {
      writerDesktop: {
        newTarget: async () => target,
        request: async (operation, options) => {
          calls.push({ operation, options });
          return { data: result };
        },
      },
    },
  });
  const changes = [];
  const deps = {
    selected: target,
    focus: {},
    canLeave: async () => true,
    selectSnapshot: async () => {},
    sendText: async () => {},
    set: (change) => changes.push(change),
  };
  return { ...renderer, calls, changes, deps };
}

test("投递被拒绝时展示失败，不切换到任务对话", async () => {
  for (const mode of ["fanqie", "toutiao"]) {
    const { deliverAction, calls, changes, deps } = setup(mode, {
      ok: false,
      error: "作品以只读方式打开",
    });
    await assert.rejects(deliverAction(deps, "review"), /作品以只读方式打开/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.kind, "write");
    assert.equal(changes.length, 0);
  }
});

test("新建头条任务被拒绝时保留入口并返回原因", async () => {
  const { startNewWork, calls, changes, deps } = setup("toutiao", {
    ok: false,
    error: "作品以只读方式打开",
  });
  await assert.rejects(startNewWork(deps, "toutiao"), /作品以只读方式打开/);
  assert.equal(calls[0].options.input.confirm, true);
  assert.equal(
    changes.some((change) => change.picker === false),
    false,
  );
});
