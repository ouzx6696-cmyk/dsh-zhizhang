import test from "node:test";
import assert from "node:assert/strict";
import { loadComponents } from "./helpers.mjs";
import { createRuntime, fakeClock, plain } from "./runtime.mjs";

const DAY = 24 * 60 * 60 * 1000;

/** 内存里的 localStorage；`full` 为真时写入抛出与浏览器相同的配额错误。 */
function memoryStorage() {
  const items = new Map();
  return {
    full: false,
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem(key, value) {
      if (this.full) throw new Error("QuotaExceededError: storage is full");
      items.set(key, String(value));
    },
    removeItem: (key) => items.delete(key),
    keys: () => [...items.keys()],
  };
}

/** 一份全新的组件包，配内存存储、假时钟与可手动触发的 pagehide。 */
function draftsFixture() {
  const runtime = createRuntime();
  const clock = fakeClock();
  const storage = memoryStorage();
  const listeners = new Map();
  const window = {
    localStorage: storage,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => {
      if (listeners.get(type) === fn) listeners.delete(type);
    },
  };
  const ui = loadComponents(runtime.react, {
    window,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Date: clock.Date,
  });
  return { runtime, clock, storage, listeners, ui };
}

// —— drafts.js ——

test("草稿键：同一组定位信息得到同一个键，任一部分不同则键不同", () => {
  const { ui } = draftsFixture();
  const parts = { mode: "fanqie", work: "w", chapter: "c001", slot: "official", revision: "r1" };
  assert.equal(ui.draftKey(parts), ui.draftKey({ ...parts }));
  assert.notEqual(ui.draftKey(parts), ui.draftKey({ ...parts, revision: "r2" }));
  assert.notEqual(ui.draftKey(parts), ui.draftKey({ ...parts, slot: "cand-1" }));
  assert.ok(ui.draftKey(parts).startsWith("dsh-writer-draft:"));
});

test("草稿：写入后读回原文与写入时间，清除后读不到", () => {
  const { ui, clock } = draftsFixture();
  const key = ui.draftKey({ work: "w", chapter: "c1" });
  clock.advance(5000);
  assert.equal(ui.writeDraft(key, "未保存的正文"), 5000);
  assert.deepEqual(plain(ui.readDraft(key)), { text: "未保存的正文", savedAt: 5000 });
  ui.clearDraft(key);
  assert.equal(ui.readDraft(key), null);
});

test("草稿：损坏或格式不对的条目被移除，不拿来提示作者", () => {
  const { ui, storage } = draftsFixture();
  const broken = ui.draftKey({ chapter: "broken" });
  const shapeless = ui.draftKey({ chapter: "shapeless" });
  storage.setItem(broken, "{not json");
  storage.setItem(shapeless, JSON.stringify({ text: 1, savedAt: "now" }));
  assert.equal(ui.readDraft(broken), null);
  assert.equal(ui.readDraft(shapeless), null);
  assert.deepEqual(storage.keys(), []);
});

test("草稿：存储本身读写失败时原样抛出，由编辑器告诉作者", () => {
  const { ui, storage } = draftsFixture();
  storage.full = true;
  assert.throws(() => ui.writeDraft(ui.draftKey({ chapter: "c1" }), "x"), /storage is full/);
});

test("草稿清理：超过两周的草稿与损坏条目被删，近期草稿与其它键保留", () => {
  const { ui, storage, clock } = draftsFixture();
  const old = ui.draftKey({ chapter: "old" });
  const fresh = ui.draftKey({ chapter: "fresh" });
  const broken = ui.draftKey({ chapter: "broken" });
  ui.writeDraft(old, "旧");
  clock.advance(DAY);
  ui.writeDraft(fresh, "新");
  storage.setItem(broken, "oops");
  storage.setItem("dsh-writer-prefs", "{}");
  clock.advance(13 * DAY);
  ui.pruneDrafts();
  assert.deepEqual(storage.keys().sort(), ["dsh-writer-prefs", fresh, old].sort());
  clock.advance(1);
  ui.pruneDrafts();
  assert.deepEqual(storage.keys().sort(), ["dsh-writer-prefs", fresh].sort());
});

// —— find.js ——

test("查找：查询按字面文字匹配，正则符号不生效", () => {
  const { ui } = draftsFixture();
  assert.deepEqual(plain(ui.findMatches("a.b axb a.b", "a.b")), [
    [0, 3],
    [8, 11],
  ]);
  assert.deepEqual(plain(ui.findMatches("(1+1)*[2] $x \\ /y/", "(1+1)*[2]")), [[0, 9]]);
  assert.deepEqual(plain(ui.findMatches("费用 $x \\ /y/", "\\ /y/")), [[6, 11]]);
  assert.deepEqual(plain(ui.findMatches("a^b|c", "^b|")), [[1, 4]]);
});

test("查找：默认不分大小写，打开区分大小写后只认原样", () => {
  const { ui } = draftsFixture();
  assert.deepEqual(plain(ui.findMatches("Ab ab AB", "ab", false)), [
    [0, 2],
    [3, 5],
    [6, 8],
  ]);
  assert.deepEqual(plain(ui.findMatches("Ab ab AB", "ab", true)), [[3, 5]]);
});

test("查找：空查询没有结果，中文与表情按字符偏移", () => {
  const { ui } = draftsFixture();
  assert.deepEqual(plain(ui.findMatches("任何文字", "")), []);
  assert.deepEqual(plain(ui.findMatches("😀甲乙甲", "甲")), [
    [2, 3],
    [4, 5],
  ]);
});

test("matchFrom：取起点在光标处或之后的第一处，越过最后一处回到第一处", () => {
  const { ui } = draftsFixture();
  const matches = [
    [2, 4],
    [10, 12],
    [20, 22],
  ];
  assert.equal(ui.matchFrom(matches, 0), 0);
  assert.equal(ui.matchFrom(matches, 2), 0);
  assert.equal(ui.matchFrom(matches, 3), 1);
  assert.equal(ui.matchFrom(matches, 20), 2);
  assert.equal(ui.matchFrom(matches, 21), 0);
  assert.equal(ui.matchFrom([], 5), 0);
});

// —— reading-position.js ——

test("阅读位置：滚动比例往返后回到同一位置，不可滚动时比例为 0", () => {
  const { ui } = draftsFixture();
  const box = { scrollTop: 300, scrollHeight: 1600, clientHeight: 400 };
  const ratio = ui.readScrollRatio(box);
  assert.equal(ratio, 0.25);
  const wider = { scrollTop: 0, scrollHeight: 2400, clientHeight: 400 };
  ui.applyScrollRatio(wider, ratio);
  assert.equal(wider.scrollTop, 500);
  assert.equal(ui.readScrollRatio({ scrollTop: 0, scrollHeight: 300, clientHeight: 400 }), 0);
});

// —— useDraftStash.js ——

function mountStash(f, { key = f.ui.draftKey({ chapter: "c1" }), initial = "盘上原文" } = {}) {
  const box = { current: null };
  function Host({ storageKey, disk, text }) {
    box.current = f.ui.useDraftStash(storageKey, disk, text);
    return null;
  }
  const view = f.runtime.mount(Host, { storageKey: key, disk: initial, text: initial });
  const type = async (text) => {
    view.rerender({ storageKey: key, disk: initial, text });
    await view.flush();
  };
  const advance = async (ms) => {
    f.clock.advance(ms);
    await view.flush();
  };
  return { key, view, type, advance, stash: () => box.current };
}

test("草稿暂存：停止输入 800 毫秒后才写入，连续输入只写最后一次", async () => {
  const f = draftsFixture();
  const m = mountStash(f);
  await m.type("改一");
  await m.advance(500);
  await m.type("改二");
  await m.advance(799);
  assert.equal(f.ui.readDraft(m.key), null);
  await m.advance(1);
  assert.equal(f.ui.readDraft(m.key).text, "改二");
  assert.equal(m.stash().stashed, "改二");
});

test("草稿暂存：改回盘上原文后草稿被清除", async () => {
  const f = draftsFixture();
  const m = mountStash(f);
  await m.type("改过");
  await m.advance(800);
  await m.type("盘上原文");
  await m.advance(800);
  assert.equal(f.ui.readDraft(m.key), null);
  assert.equal(m.stash().stashed, "盘上原文");
});

test("草稿暂存：打开时提示与原文不同的旧草稿，提示期间输入不覆盖它", async () => {
  const f = draftsFixture();
  const key = f.ui.draftKey({ chapter: "c1" });
  f.ui.writeDraft(key, "上次没保存的");
  const m = mountStash(f, { key });
  assert.equal(m.stash().offer.text, "上次没保存的");
  await m.type("新输入");
  await m.advance(5000);
  assert.equal(f.ui.readDraft(key).text, "上次没保存的");
  assert.equal(m.stash().restore(), "上次没保存的");
  await m.view.flush();
  assert.equal(m.stash().offer, null);
});

test("草稿暂存：与盘上原文相同的旧草稿不提示", async () => {
  const f = draftsFixture();
  const key = f.ui.draftKey({ chapter: "c1" });
  f.ui.writeDraft(key, "盘上原文");
  const m = mountStash(f, { key });
  assert.equal(m.stash().offer, null);
});

test("草稿暂存：作者放弃旧草稿后，当前编辑器里的文字立即写入", async () => {
  const f = draftsFixture();
  const key = f.ui.draftKey({ chapter: "c1" });
  f.ui.writeDraft(key, "旧草稿");
  const m = mountStash(f, { key });
  await m.type("现在的");
  m.stash().drop();
  await m.view.flush();
  assert.equal(m.stash().offer, null);
  assert.equal(f.ui.readDraft(key).text, "现在的");
});

test("草稿暂存：打开时清掉超期草稿", async () => {
  const f = draftsFixture();
  const stale = f.ui.draftKey({ chapter: "stale" });
  f.ui.writeDraft(stale, "很久以前");
  f.clock.advance(15 * DAY);
  mountStash(f);
  assert.equal(f.storage.getItem(stale), null);
});

test("草稿暂存：保存或丢弃（settle）后草稿删除，之后的输入与卸载都不再写回", async () => {
  const f = draftsFixture();
  const m = mountStash(f);
  await m.type("改过");
  await m.advance(800);
  m.stash().settle();
  assert.equal(f.ui.readDraft(m.key), null);
  await m.type("又改");
  await m.advance(800);
  m.view.unmount();
  assert.equal(f.ui.readDraft(m.key), null);
});

test("草稿暂存：编辑器卸载或窗口 pagehide 时立刻写入尚未暂存的文字", async () => {
  const f = draftsFixture();
  const m = mountStash(f);
  await m.type("关窗前");
  f.listeners.get("pagehide")();
  await m.view.flush();
  assert.equal(f.ui.readDraft(m.key).text, "关窗前");
  await m.type("卸载前");
  m.view.unmount();
  assert.equal(f.ui.readDraft(m.key).text, "卸载前");
  assert.equal(f.listeners.has("pagehide"), false);
});

test("草稿暂存：存储写满时报告失败，文字仍在编辑器里，恢复后失败提示消失", async () => {
  const f = draftsFixture();
  const m = mountStash(f);
  f.storage.full = true;
  await m.type("写不进去");
  await m.advance(800);
  assert.match(m.stash().failure, /storage is full/);
  assert.equal(m.stash().stashed, "盘上原文");
  f.storage.full = false;
  await m.type("再试");
  await m.advance(800);
  assert.equal(m.stash().failure, "");
  assert.equal(f.ui.readDraft(m.key).text, "再试");
});

test("草稿暂存：打开时存储不可读，失败显示出来而编辑照常", async () => {
  const f = draftsFixture();
  f.storage.getItem = () => {
    throw new Error("SecurityError: storage disabled");
  };
  const m = mountStash(f);
  assert.equal(m.stash().offer, null);
  assert.match(m.stash().failure, /storage disabled/);
});
