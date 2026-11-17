import assert from "node:assert/strict";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";

const desk = await importBundle("test/support/desktop-entry.ts");

const target = (mode, path) => ({ mode, path });
const A = target("fanqie", "长篇/夜航");
const B = target("fanqie", "长篇/灯塔");

/** 替换 desktop 上的目标方法；返回还原函数。 */
function stub(methods) {
  const original = {};
  for (const [name, impl] of Object.entries(methods)) {
    original[name] = desk.desktop[name];
    desk.desktop[name] = impl;
  }
  return () => {
    for (const [name, impl] of Object.entries(original)) desk.desktop[name] = impl;
  };
}

function resetState() {
  desk.desktopStore.set({ selected: null, focus: {}, view: "writing", compare: null });
  desk.chatStore.set({
    ...desk.chatStore.get(),
    scope: "",
    usage: undefined,
    messages: [],
    busy: false,
    stream: null,
    conversationId: "",
    conversations: [],
  });
}

test("D10: A 慢 B 快乱序返回 → selected 为 B，A 的晚到结果被丢弃", async () => {
  resetState();
  let resolveA;
  let selectCalls = [];
  const restore = stub({
    async select(t) {
      selectCalls.push(t);
      if (t.path === A.path) {
        return await new Promise((resolve) => {
          resolveA = () => resolve({ target: t, label: "夜航" });
        });
      }
      return { target: t, label: "灯塔" };
    },
    async sessionView() {
      return {
        conversationId: "c",
        messages: [],
        total: 0,
        busy: false,
        stream: null,
        task: null,
      };
    },
    async conversations() {
      return [];
    },
  });
  try {
    const first = desk.selectTarget(A);
    // 先让 A 的慢请求真正挂起，再发起 B
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(selectCalls.length, 1);
    await desk.selectTarget(B);
    // B 已落库；A 的慢响应此时才回来
    assert.equal(desk.desktopStore.get().selected.label, "灯塔");
    resolveA();
    await first;
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(desk.desktopStore.get().selected.label, "灯塔", "晚到的 A 不得覆盖 B");
    assert.equal(selectCalls.length, 2);
  } finally {
    restore();
  }
});

test("D10: 切换作品后 usage 晚到 → 不写入新目标", async () => {
  resetState();
  desk.desktopStore.set({ selected: { target: A, label: "夜航" } });
  let releaseUsage;
  const restore = stub({
    async contextUsage() {
      return await new Promise((resolve) => {
        releaseUsage = () => resolve({ messages: 9, percent: 90 });
      });
    },
  });
  try {
    const pending = desk.refreshUsage();
    // 用量未返回时切换到 B
    desk.desktopStore.set({ selected: { target: B, label: "灯塔" } });
    releaseUsage();
    await pending;
    assert.equal(desk.chatStore.get().usage, undefined, "晚到的 usage 不得写入新目标");

    // 目标未变时正常写入
    const ok = desk.refreshUsage().then(() => undefined);
    releaseUsage();
    await ok;
    assert.equal(desk.chatStore.get().usage?.percent, 90);
  } finally {
    restore();
  }
});
