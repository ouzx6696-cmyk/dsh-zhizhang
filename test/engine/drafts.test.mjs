import test from "node:test";
import assert from "node:assert/strict";
import { loadComponents } from "./helpers.mjs";
import { byClass, createRuntime, fakeClock, findAll, plain, text } from "./runtime.mjs";

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
      if (this.full) throw new DOMException("storage is full", "QuotaExceededError");
      items.set(key, String(value));
    },
    removeItem: (key) => items.delete(key),
    keys: () => [...items.keys()],
  };
}

/** 一份全新的组件包，配内存存储、假时钟、可手动触发的 pagehide 与记下来的控制台告警。 */
function draftsFixture() {
  const clock = fakeClock();
  const runtime = createRuntime({
    hostNode: () => ({ scrollTop: 0, scrollHeight: 0, clientHeight: 0, focus() {} }),
  });
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
    DOMException,
  });
  return { runtime, clock, storage, listeners, ui };
}

const CHAPTER = { base: "b", work: "w", chapter: "c001", slot: "official" };
const expectedKey = (parts) => "dsh-writer-draft:" + JSON.stringify(parts);

// —— drafts.js ——

test("草稿键：只含模式、作品、章节与槽位，不含版本；槽位或作品不同则键不同", () => {
  const { ui } = draftsFixture();
  assert.equal(ui.chapterDraftKey(CHAPTER), ui.chapterDraftKey({ ...CHAPTER }));
  assert.equal(ui.chapterDraftKey(CHAPTER), expectedKey(["fanqie", "b", "w", "c001", "official"]));
  assert.notEqual(ui.chapterDraftKey(CHAPTER), ui.chapterDraftKey({ ...CHAPTER, slot: "cand-1" }));
  assert.notEqual(ui.chapterDraftKey(CHAPTER), ui.chapterDraftKey({ ...CHAPTER, work: "w2" }));
  assert.equal(ui.articleDraftKey({ root: "r", id: "a1" }), expectedKey(["toutiao", "r", "a1"]));
});

test("草稿：写入后读回原文、写入时间与起草时的版本，清除后读不到", () => {
  const { ui, clock } = draftsFixture();
  const key = ui.chapterDraftKey(CHAPTER);
  clock.advance(5000);
  assert.equal(ui.writeDraft(key, "未保存的正文", "r1"), 5000);
  assert.deepEqual(plain(ui.readDraft(key)), {
    text: "未保存的正文",
    savedAt: 5000,
    baseRevision: "r1",
  });
  ui.clearDraft(key);
  assert.equal(ui.readDraft(key), null);
});

test("草稿：损坏、格式不对或缺起草版本的条目被移除，不拿来提示作者", () => {
  const { ui, storage } = draftsFixture();
  const broken = ui.chapterDraftKey({ ...CHAPTER, chapter: "broken" });
  const shapeless = ui.chapterDraftKey({ ...CHAPTER, chapter: "shapeless" });
  const baseless = ui.chapterDraftKey({ ...CHAPTER, chapter: "baseless" });
  storage.setItem(broken, "{not json");
  storage.setItem(shapeless, JSON.stringify({ text: 1, savedAt: "now" }));
  storage.setItem(baseless, JSON.stringify({ text: "x", savedAt: 1 }));
  assert.equal(ui.readDraft(broken), null);
  assert.equal(ui.readDraft(shapeless), null);
  assert.equal(ui.readDraft(baseless), null);
  assert.deepEqual(storage.keys(), []);
});

test("草稿：存储本身读写失败时原样抛出，由编辑器告诉作者", () => {
  const { ui, storage } = draftsFixture();
  storage.full = true;
  assert.throws(() => ui.writeDraft(ui.chapterDraftKey(CHAPTER), "x", "r1"), /storage is full/);
});

test("未保存的草稿超过两周仍可恢复，保存或放弃后由作者清除", () => {
  const { ui, clock } = draftsFixture();
  const key = ui.chapterDraftKey(CHAPTER);
  ui.writeDraft(key, "长期保留的正文", "r1");
  clock.advance(30 * DAY);
  assert.deepEqual(plain(ui.readDraft(key)), {
    text: "长期保留的正文",
    savedAt: 0,
    baseRevision: "r1",
  });
  ui.clearDraft(key);
  assert.equal(ui.readDraft(key), null);
});

test("其它作品的草稿：同一作品的其它章节与槽位不算，其它作品与头条文章算", () => {
  const { ui } = draftsFixture();
  const own = ui.chapterDraftKey(CHAPTER);
  const sameWork = ui.chapterDraftKey({ ...CHAPTER, chapter: "c002", slot: "cand-1" });
  const otherWork = ui.chapterDraftKey({ ...CHAPTER, work: "w2" });
  const article = ui.articleDraftKey({ root: "r", id: "a1" });
  for (const key of [own, sameWork, otherWork, article]) ui.writeDraft(key, "x", "r1");
  assert.deepEqual(plain(ui.otherDraftKeys(own)).sort(), [otherWork, article].sort());
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

function mountStash(
  f,
  { key = f.ui.chapterDraftKey(CHAPTER), initial = "盘上原文", base = "r1" } = {},
) {
  const box = { current: null };
  // 提示栈与草稿暂存挂在同一棵树里，写满时的提示能直接读到。
  function Host({ storageKey, disk, text }) {
    box.current = f.ui.useDraftStash(storageKey, disk, text, base);
    return f.runtime.react.createElement(f.ui.NoticeStack, { label: "提示" });
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
  const notices = () => byClass(view.tree, "ui-notice");
  return { key, view, type, advance, notices, stash: () => box.current };
}

test("草稿暂存：停止输入 800 毫秒后才写入，连续输入只写最后一次，带上起草版本", async () => {
  const f = draftsFixture();
  const m = mountStash(f);
  await m.type("改一");
  await m.advance(500);
  await m.type("改二");
  await m.advance(799);
  assert.equal(f.ui.readDraft(m.key), null);
  await m.advance(1);
  assert.equal(f.ui.readDraft(m.key).text, "改二");
  assert.equal(f.ui.readDraft(m.key).baseRevision, "r1");
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
  const key = f.ui.chapterDraftKey(CHAPTER);
  f.ui.writeDraft(key, "上次没保存的", "r1");
  const m = mountStash(f, { key });
  assert.equal(m.stash().offer.text, "上次没保存的");
  await m.type("新输入");
  await m.advance(5000);
  assert.equal(f.ui.readDraft(key).text, "上次没保存的");
  assert.equal(m.stash().restore(), "上次没保存的");
  await m.view.flush();
  assert.equal(m.stash().offer, null);
});

test("草稿暂存：章节版本变了（r1 → r2）重开编辑器仍提示，恢复后以 r1 为准", async () => {
  const f = draftsFixture();
  const key = f.ui.chapterDraftKey(CHAPTER);
  f.ui.writeDraft(key, "基于 r1 的修改", "r1");
  const m = mountStash(f, { key, initial: "流水线写出的 r2", base: "r2" });
  assert.equal(m.stash().offer.text, "基于 r1 的修改");
  assert.equal(m.stash().base, "r2");
  assert.equal(m.stash().restore(), "基于 r1 的修改");
  await m.view.flush();
  assert.equal(m.stash().base, "r1");
  await m.type("基于 r1 的修改，又改一句");
  await m.advance(800);
  assert.equal(f.ui.readDraft(key).baseRevision, "r1");
});

test("草稿暂存：放弃旧草稿后按编辑器打开时的版本暂存", async () => {
  const f = draftsFixture();
  const key = f.ui.chapterDraftKey(CHAPTER);
  f.ui.writeDraft(key, "旧草稿", "r1");
  const m = mountStash(f, { key, base: "r2" });
  await m.type("现在的");
  m.stash().drop();
  await m.view.flush();
  assert.equal(m.stash().offer, null);
  assert.equal(m.stash().base, "r2");
  assert.deepEqual([f.ui.readDraft(key).text, f.ui.readDraft(key).baseRevision], ["现在的", "r2"]);
});

test("草稿暂存：与盘上原文相同的旧草稿不提示", async () => {
  const f = draftsFixture();
  const key = f.ui.chapterDraftKey(CHAPTER);
  f.ui.writeDraft(key, "盘上原文", "r1");
  const m = mountStash(f, { key });
  assert.equal(m.stash().offer, null);
});

test("草稿暂存：打开编辑器不清理别处的草稿", async () => {
  const f = draftsFixture();
  const stale = f.ui.chapterDraftKey({ ...CHAPTER, chapter: "stale" });
  f.ui.writeDraft(stale, "很久以前", "r1");
  f.clock.advance(15 * DAY);
  mountStash(f);
  assert.equal(f.ui.readDraft(stale).text, "很久以前");
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

test("草稿暂存：写满时发 danger 提示，作者确认后才清其它作品的草稿，随后重新暂存", async () => {
  const f = draftsFixture();
  const sameWork = f.ui.chapterDraftKey({ ...CHAPTER, chapter: "c002" });
  const otherWork = f.ui.chapterDraftKey({ ...CHAPTER, work: "w2" });
  f.ui.writeDraft(sameWork, "本书别的章", "r1");
  f.ui.writeDraft(otherWork, "另一本书", "r1");
  const answers = [];
  f.ui.setConfirm((message) => {
    answers.push(message);
    return Promise.resolve(answers.length > 1);
  });
  const m = mountStash(f);
  f.storage.full = true;
  await m.type("写不进去");
  await m.advance(800);
  const [notice] = m.notices();
  assert.equal(notice.props["data-tone"], "danger");
  assert.match(text(notice), /草稿空间已满/);
  assert.equal(f.ui.readDraft(otherWork).text, "另一本书");
  const run = async () => {
    byClass(m.notices()[0], "ui-notice-action")[0].props.onClick();
    await m.view.flush();
  };
  await run();
  assert.match(answers[0], /1 份/);
  assert.equal(f.ui.readDraft(otherWork).text, "另一本书");
  await m.type("还是写不进去");
  await m.advance(800);
  // 腾出空间后的重新暂存不再碰到配额。
  f.storage.full = false;
  await run();
  assert.equal(f.storage.getItem(otherWork), null);
  assert.equal(f.ui.readDraft(sameWork).text, "本书别的章");
  assert.equal(f.ui.readDraft(m.key).text, "还是写不进去");
  assert.equal(m.stash().failure, "");
});

test("草稿暂存：写满但没有其它作品的草稿时，提示不带清理动作", async () => {
  const f = draftsFixture();
  const m = mountStash(f);
  f.storage.full = true;
  await m.type("写不进去");
  await m.advance(800);
  assert.equal(m.notices().length, 1);
  assert.equal(byClass(m.notices()[0], "ui-notice-action").length, 0);
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

// —— SourceEditor.jsx ——

/** 按按钮文字找到它并点一下。 */
async function press(view, label) {
  const [button] = findAll(view.tree, (n) => n.type === "button" && text(n) === label);
  assert.ok(button, `应有按钮“${label}”`);
  await button.props.onClick();
  await view.flush();
}

function mountEditor(f, onSave) {
  return f.runtime.mount(f.ui.SourceEditor, {
    initial: "流水线写出的 r2",
    draftKey: f.ui.chapterDraftKey(CHAPTER),
    baseRevision: "r2",
    position: { current: 0 },
    onSave,
    onCancel() {},
  });
}

test("编辑器：版本变化后重开仍提示草稿；恢复后保存以草稿的 r1 提交，冲突时草稿保留", async () => {
  const f = draftsFixture();
  f.ui.writeDraft(f.ui.chapterDraftKey(CHAPTER), "基于 r1 的修改", "r1");
  const calls = [];
  const view = mountEditor(f, async (body, base) => {
    calls.push([body, base]);
    throw new Error("目标章已变化，请读取现行正文后重新准备候选。");
  });
  await view.flush();
  assert.match(text(view.tree), /暂存的未保存草稿/);
  await press(view, "恢复");
  await press(view, "保存修改");
  assert.deepEqual(calls, [["基于 r1 的修改", "r1"]]);
  const alerts = findAll(view.tree, (n) => n.type === "p" && n.props.role === "alert");
  assert.match(text(alerts), /目标章已变化/);
  assert.equal(f.ui.readDraft(f.ui.chapterDraftKey(CHAPTER)).text, "基于 r1 的修改");
});

test("编辑器：没有草稿时按打开时的版本保存，保存成功后草稿清除", async () => {
  const f = draftsFixture();
  const calls = [];
  const view = mountEditor(f, async (body, base) => calls.push([body, base]));
  await view.flush();
  findAll(view.tree, (n) => n.type === "textarea")[0].props.onChange({
    target: { value: "作者改了一句" },
  });
  await view.flush();
  f.clock.advance(800);
  await view.flush();
  assert.equal(f.ui.readDraft(f.ui.chapterDraftKey(CHAPTER)).baseRevision, "r2");
  await press(view, "保存修改");
  assert.deepEqual(calls, [["作者改了一句", "r2"]]);
  assert.equal(f.ui.readDraft(f.ui.chapterDraftKey(CHAPTER)), null);
});
