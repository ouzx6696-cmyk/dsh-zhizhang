import test from "node:test";
import assert from "node:assert/strict";
import { loadRenderer } from "../engine/helpers.mjs";
import { createRuntime, plain } from "../engine/runtime.mjs";

const { createStore, sameFields, footerStatus, quickActions } = loadRenderer(createRuntime().react);

test("sameFields：字段集合与每个值都相同才算相同", () => {
  const shared = {};
  assert.equal(sameFields({ a: 1, b: shared }, { b: shared, a: 1 }), true);
  assert.equal(sameFields({ a: 1 }, { a: 1, b: undefined }), false);
  assert.equal(sameFields({ a: 1, b: undefined }, { a: 1, c: undefined }), false);
  assert.equal(sameFields({ a: {} }, { a: {} }), false);
  assert.equal(sameFields({ a: NaN }, { a: NaN }), true);
});

test("createStore：值没有变化的补丁不通知订阅者，退订后不再通知", () => {
  const store = createStore({ tab: "a", count: 0 });
  let calls = 0;
  const unsubscribe = store.subscribe(() => (calls += 1));
  store.set({ tab: "a" });
  assert.equal(calls, 0);
  store.set((state) => ({ count: state.count + 1 }));
  assert.deepEqual(plain(store.get()), { tab: "a", count: 1 });
  assert.equal(calls, 1);
  unsubscribe();
  store.set({ tab: "b" });
  assert.equal(calls, 1);
  assert.equal(store.get().tab, "b");
});

const footer = (patch = {}) => ({
  archived: false,
  readOnly: false,
  hasWork: true,
  model: { configured: true, model: "m1" },
  busy: false,
  task: null,
  ...patch,
});

test("footerStatus：按规则顺序取第一条成立的状态", () => {
  assert.equal(footerStatus(footer({ archived: true, readOnly: true })), "正在查看旧对话 · 只读");
  assert.equal(footerStatus(footer({ readOnly: true, hasWork: false })), "只读打开 · 不能发送");
  assert.equal(
    footerStatus(footer({ hasWork: false, model: { configured: false, model: "" } })),
    "先选择作品",
  );
  assert.equal(
    footerStatus(footer({ model: { configured: false, model: "" } })),
    "尚未配置写作模型",
  );
  assert.equal(footerStatus(footer({ busy: true })), "生成中 · m1");
  assert.equal(footerStatus(footer()), "就绪 · m1");
});

test("footerStatus：有用量的任务显示用量与费用，费用为 0 视为未知", () => {
  const task = {
    name: "t",
    completed: [],
    current: "",
    waiting: "",
    tokens: 0,
    cost: 0.5,
    startedAt: 0,
    usage: { input: 1000, output: 20, cacheRead: 200, cacheWrite: 0 },
  };
  const running = footerStatus(footer({ busy: true, task }));
  assert.ok(running.startsWith("生成中 · 输入 "));
  assert.ok(running.endsWith(" · $0.5000"));
  const last = footerStatus(footer({ task: { ...task, cost: 0 } }));
  assert.ok(last.startsWith("上次任务 · "));
  assert.ok(last.endsWith(" · 费用未知"));
});

test("quickActions：交稿后的文章、普通文章与默认组合各取各的快捷动作，按钮文字可覆盖命令名", () => {
  const shape = (context) =>
    plain(quickActions(context).map((action) => [action.id, action.label]));
  const submitted = shape({ kind: "article", article: { status: "已交稿" } });
  const article = shape({ kind: "article", article: { status: "草稿" } });
  const fallback = shape({});
  assert.equal(submitted.length, 2);
  assert.equal(article.length, 3);
  assert.equal(fallback.length, 3);
  assert.deepEqual(article[0], ["续写", "继续推进"]);
  assert.notDeepEqual(article, fallback);
  for (const [, label] of [...submitted, ...article, ...fallback])
    assert.ok(typeof label === "string" && label.length > 0);
});

test("quickActions：章纲未就绪先于候选稿与审稿结论", () => {
  const shape = (context) => plain(quickActions(context).map((action) => action.id));
  const outline = shape({ chapter: { id: "c1" }, outlineReady: false, hasCandidate: true });
  const candidate = shape({ chapter: { id: "c1" }, outlineReady: true, hasCandidate: true });
  assert.equal(outline.length, 2);
  assert.equal(candidate.length, 3);
  assert.notDeepEqual(outline, candidate);
});
