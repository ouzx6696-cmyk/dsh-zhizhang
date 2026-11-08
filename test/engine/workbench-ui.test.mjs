import test from "node:test";
import assert from "node:assert/strict";
import { loadComponents } from "./helpers.mjs";
import { byClass, createRuntime, fakeClock, findAll, text } from "./runtime.mjs";

function deferred() {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
}

/** 方法方案弹窗：两份用户方案，详情与方法全文都由测试决定何时返回。 */
function profilesFixture(answer = { confirm: true }) {
  const runtime = createRuntime();
  const window = {
    confirm: () => answer.confirm,
    addEventListener() {},
    removeEventListener() {},
  };
  const { ProfilesDialog } = loadComponents(runtime.react, { window });
  const details = [];
  const methods = [];
  const api = {
    list: async () => ({
      profiles: [
        { id: "a", name: "甲方案", kind: "user", methods: 2, active: true },
        { id: "b", name: "乙方案", kind: "user", methods: 1 },
      ],
      active: "a",
      pinned: false,
    }),
    detail(id) {
      const d = deferred();
      details.push({ id, ...d });
      return d.promise;
    },
    method(profile, id) {
      const d = deferred();
      methods.push({ profile, id, ...d });
      return d.promise;
    },
  };
  const view = runtime.mount(ProfilesDialog, { mode: "fanqie", api, onClose() {}, inline: true });
  const profileButton = (name) =>
    byClass(view.tree, "wb-pf-item").find((n) => text(n).includes(name));
  const methodButton = (title) =>
    byClass(view.tree, "wb-pf-method").find((n) => text(n).includes(title));
  const methodTitles = () => byClass(view.tree, "wb-pf-method-title").map(text);
  return { view, details, methods, profileButton, methodButton, methodTitles };
}

const A_METHODS = {
  methods: [
    { id: "a-1", title: "甲一" },
    { id: "a-2", title: "甲二" },
  ],
};

test("方法方案：快速切换方案时，晚到的旧方案详情不覆盖当前方案的方法清单", async () => {
  const f = profilesFixture();
  await f.view.flush();
  assert.equal(f.details.at(-1).id, "a");
  f.profileButton("乙方案").props.onClick();
  await f.view.flush();
  assert.equal(f.details.at(-1).id, "b");
  // 切换后、新详情返回前，不再把上一份方案的方法当作当前方案展示。
  assert.deepEqual(f.methodTitles(), []);
  f.details.find((d) => d.id === "b").resolve({ methods: [{ id: "b-1", title: "乙一" }] });
  await f.view.flush();
  f.details.find((d) => d.id === "a").resolve(A_METHODS);
  await f.view.flush();
  assert.deepEqual(f.methodTitles(), ["乙一"]);
});

test("方法方案：先后打开两份方法，先发的回执晚到不覆盖后打开的全文", async () => {
  const f = profilesFixture();
  await f.view.flush();
  f.details[0].resolve(A_METHODS);
  await f.view.flush();
  f.methodButton("甲一").props.onClick();
  await f.view.flush();
  f.methodButton("甲二").props.onClick();
  await f.view.flush();
  f.methods[1].resolve({ method: { id: "a-2", text: "第二份全文", from: "user" }, base_text: "" });
  await f.view.flush();
  f.methods[0].resolve({ method: { id: "a-1", text: "第一份全文", from: "user" }, base_text: "" });
  await f.view.flush();
  assert.equal(text(byClass(f.view.tree, "wb-pf-editor-id")), "甲二");
  assert.ok(text(byClass(f.view.tree, "wb-pf-reading")).includes("第二份全文"));
  assert.ok(!text(byClass(f.view.tree, "wb-pf-reading")).includes("第一份全文"));
  // 筛选把当前方法从清单里藏起来时，右列标题仍是这份方法的标题。
  findAll(
    f.view.tree,
    (n) => n.type === "input" && n.props.placeholder !== undefined,
  )[0].props.onChange({
    target: { value: "不存在" },
  });
  await f.view.flush();
  assert.deepEqual(f.methodTitles(), []);
  assert.equal(text(byClass(f.view.tree, "wb-pf-editor-id")), "甲二");
});

test("方法方案：有未保存修改时切换方案先确认，作者取消则留在原方案", async () => {
  const answer = { confirm: false };
  const f = profilesFixture(answer);
  await f.view.flush();
  f.details[0].resolve(A_METHODS);
  await f.view.flush();
  f.methodButton("甲一").props.onClick();
  await f.view.flush();
  f.methods[0].resolve({ method: { id: "a-1", text: "原文", from: "user" }, base_text: "" });
  await f.view.flush();
  const tabs = findAll(f.view.tree, (n) => n.type === "button" && "aria-pressed" in n.props);
  assert.ok(tabs.every((tab) => tab.props.type === "button"));
  tabs.find((tab) => text(tab) && tab.props["aria-pressed"] === false).props.onClick();
  await f.view.flush();
  findAll(f.view.tree, (n) => n.type === "textarea")[0].props.onChange({
    target: { value: "改过" },
  });
  await f.view.flush();
  f.profileButton("乙方案").props.onClick();
  await f.view.flush();
  assert.equal(f.details.length, 1);
  assert.equal(findAll(f.view.tree, (n) => n.type === "textarea")[0].props.value, "改过");
  answer.confirm = true;
  f.profileButton("乙方案").props.onClick();
  await f.view.flush();
  assert.equal(f.details.at(-1).id, "b");
});

test("番茄写作台：投递进行中切换作品或项目，写作 Agent 按钮不再停在“进行中”", async () => {
  const { initialState, reducer } = loadComponents(createRuntime().react);
  const busy = reducer(initialState(), { type: "deliver", value: { busy: "continue" } });
  const withCaps = reducer(busy, { type: "deliver", value: { caps: { deliver: true } } });
  const switched = reducer(withCaps, { type: "selectWork", work: "another-work" });
  assert.equal(switched.deliver.busy, "");
  assert.deepEqual(switched.deliver.caps, { deliver: true });
  assert.equal(reducer(withCaps, { type: "selectProject", id: "p2" }).deliver.busy, "");
});

test("番茄全书总览：作者拒绝离开当前编辑时，点章节不切到章节视图", async () => {
  const runtime = createRuntime();
  const { Pipeline } = loadComponents(runtime.react);
  const seen = [];
  const dispatch = (action) => {
    seen.push(action.type);
    return action.type !== "selectChapter";
  };
  const view = runtime.mount(Pipeline, {
    state: { tab: "writing" },
    view: {
      snap: { chapters: [{ id: "c001", title: "第一章", status: "draft" }], foundation: {} },
      pending: [],
    },
    actions: { dispatch },
  });
  byClass(view.tree, "wb-row-button")[0].props.onClick();
  assert.deepEqual(seen, ["selectChapter"]);
});

test("采用按钮：第二次采用完成同样闪现对勾反馈", async () => {
  const runtime = createRuntime();
  const clock = fakeClock();
  const { ActionButton } = loadComponents(runtime.react, {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const props = (done) => ({ done, icon: "stamp", children: "采用" });
  const iconName = (view) => view.raw.children[0].props.icon?.props?.name;
  const view = runtime.mount(ActionButton, props(undefined));
  assert.equal(iconName(view), undefined);
  view.rerender(props(1000));
  await view.flush();
  assert.equal(iconName(view), "check");
  clock.advance(2000);
  await view.flush();
  assert.equal(iconName(view), undefined);
  view.rerender(props(2000));
  await view.flush();
  assert.equal(iconName(view), "check");
});

// —— T11 连续性面板：仪表盘伏笔看板 / 知情时间线 ——

function dashboardSnap(continuityView) {
  return {
    title: "看板之书",
    chapters: [
      { id: "c001", title: "一", status: "final", wordCount: 100, position: 1 },
      { id: "c002", title: "二", status: "final", wordCount: 100, position: 2 },
      { id: "c003", title: "三", status: "drafted", wordCount: 100, position: 3 },
    ],
    foundation: { threads: "legacy 线头" },
    ledgerRecent: [],
    candidates: [],
    revisionImpacts: [],
    totals: { chapters: 3, words: 300, final: 2, drafted: 1, planned: 0 },
    ...(continuityView ? { continuityView } : {}),
  };
}

const CONTINUITY_VIEW = {
  lines: [
    {
      id: "LZ",
      title: "远期线",
      seed: "s",
      plannedPlant: 1,
      plannedPayoff: 9,
      status: "planned",
      beats: [1],
    },
    {
      id: "LM",
      title: "错过线",
      seed: "s",
      plannedPlant: 1,
      plannedPayoff: 2,
      status: "missed",
      beats: [1],
    },
    {
      id: "LC",
      title: "兑现线",
      seed: "s",
      plannedPlant: 1,
      plannedPayoff: 3,
      status: "committed",
      beats: [1, 3],
    },
    {
      id: "LO",
      title: "逾期线",
      seed: "s",
      plannedPlant: 1,
      plannedPayoff: 2,
      status: "planned",
      beats: [1],
    },
  ],
  knowledge: [
    { id: "k2", fact: "事实乙", holders: [{ who: "乙", level: "知情", since: 2 }] },
    { id: "k1", fact: "事实甲", holders: [{ who: "甲", level: "不知", since: 1 }] },
  ],
  handoff: {
    chapter: "c003",
    summary: "钥匙到手",
    mustCarry: ["钥匙必须随身"],
    openLoops: ["LZ 未闭环"],
  },
  breachCount: 1,
};

function mountDashboard(snap) {
  const runtime = createRuntime();
  const { Pipeline } = loadComponents(runtime.react);
  return runtime.mount(Pipeline, {
    state: {},
    view: { snap, pending: [] },
    actions: { dispatch: () => true },
  });
}

test("番茄仪表盘：伏笔看板按回收章排序、missed 标红、legacy 备忘置于看板之后", async () => {
  const view = await mountDashboard(dashboardSnap(CONTINUITY_VIEW)).flush();
  const cardTitles = findAll(view.tree, (n) => n.type === "h3").map(text);
  assert.deepEqual(
    cardTitles.filter((title) =>
      ["伏笔看板", "知情时间线", "伏笔备忘", "最近动态"].includes(title),
    ),
    ["伏笔看板", "知情时间线", "伏笔备忘", "最近动态"],
  );
  const rows = byClass(view.tree, "wb-row");
  const rowTitle = (row) => text(row.children[0]);
  // 未兑现线按 plannedPayoff 排序：错过线(2)、逾期线(2)、远期线(9)；已兑现的兑现线不进看板。
  assert.deepEqual(rows.slice(0, 3).map(rowTitle), ["错过线", "逾期线", "远期线"]);
  const tagOf = (row) =>
    row.children.find((child) => String(child.props?.className || "").includes("wb-tag"));
  // missed 单独标红；已写完的最新章是第 3 章，计划第 2 章回收的逾期线标警。
  assert.equal(tagOf(rows[0]).props["data-tone"], "danger");
  assert.equal(text(tagOf(rows[0])), "已逾期");
  assert.equal(tagOf(rows[1]).props["data-tone"], "warning");
  assert.equal(text(tagOf(rows[1])), "计划 · 逾期");
  assert.equal(tagOf(rows[2]).props["data-tone"], "neutral");
  assert.equal(text(tagOf(rows[2])), "计划");
  // 知情时间线按 since 章排序；每行 who · level · since。
  const timelineRows = rows.slice(3, 5);
  assert.deepEqual(timelineRows.map(rowTitle), ["事实甲", "事实乙"]);
  assert.match(text(timelineRows[0]), /甲 · 不知 · 第 1 章/);
  assert.match(text(timelineRows[1]), /乙 · 知情 · 第 2 章/);
  const all = text(view.tree);
  assert.ok(all.includes("已兑现 1 条"));
  assert.ok(all.includes("上章交接：钥匙到手"));
  assert.ok(all.includes("legacy 线头"));
});

test("番茄仪表盘：连续性没有快照段（开关关）时不渲染看板卡，legacy 备忘保留", async () => {
  const view = await mountDashboard(dashboardSnap(null)).flush();
  const cardTitles = findAll(view.tree, (n) => n.type === "h3").map(text);
  assert.ok(!cardTitles.includes("伏笔看板"));
  assert.ok(!cardTitles.includes("知情时间线"));
  assert.ok(cardTitles.includes("伏笔备忘"));
  assert.equal(byClass(view.tree, "wb-row").length, 0);
});
