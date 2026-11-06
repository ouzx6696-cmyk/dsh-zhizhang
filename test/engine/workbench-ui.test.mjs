import test from "node:test";
import assert from "node:assert/strict";
import { loadComponents } from "./helpers.mjs";

/**
 * 最小 hook 运行时：按调用顺序保存 state / ref / memo / effect，setState 之后由 flush 重渲染。
 * 用来在 Node 里驱动写作台组件的真实异步状态流，不引入新的测试依赖。
 * 子组件展开时不占用槽位（只读渲染），被测组件本身的状态完整保留。
 */
function createRuntime() {
  const slots = [];
  let cursor = 0;
  let pending = [];
  let dirty = false;
  let stateless = false;
  const same = (a, b) =>
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((v, i) => Object.is(v, b[i]));
  const slot = (init) => {
    if (stateless) return { value: init() };
    const index = cursor++;
    if (!(index in slots)) slots[index] = { value: init() };
    return slots[index];
  };
  const react = {
    createElement: (type, props, ...children) => ({
      type,
      props: props || {},
      children: children.flat(),
    }),
    Component: class {},
    Fragment: "fragment",
    memo: (component) => component,
    useId: () => "id",
    useState(initial) {
      const cell = slot(() => (typeof initial === "function" ? initial() : initial));
      const set = (next) => {
        const value = typeof next === "function" ? next(cell.value) : next;
        if (Object.is(value, cell.value)) return;
        cell.value = value;
        dirty = true;
      };
      return [cell.value, set];
    },
    useRef: (initial) => slot(() => ({ current: initial })).value,
    useMemo(factory, deps) {
      const cell = slot(() => ({ deps: undefined, result: undefined }));
      if (stateless) return factory();
      if (!same(cell.value.deps, deps)) cell.value = { deps, result: factory() };
      return cell.value.result;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useEffect(effect, deps) {
      if (stateless) return;
      const cell = slot(() => ({ deps: undefined, cleanup: undefined }));
      if (same(cell.value.deps, deps)) return;
      pending.push(() => {
        if (typeof cell.value.cleanup === "function") cell.value.cleanup();
        cell.value = { deps, cleanup: effect() };
      });
    },
  };
  const expand = (node) => {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== "object") return node;
    if (typeof node.type === "function") {
      stateless = true;
      let out;
      try {
        out = node.type({ ...node.props, children: node.children });
      } finally {
        stateless = false;
      }
      return expand(out);
    }
    return { ...node, children: expand(node.children) };
  };
  return {
    react,
    mount(Component, initialProps) {
      let props = initialProps;
      let raw;
      const render = () => {
        cursor = 0;
        dirty = false;
        raw = Component(props);
        const effects = pending;
        pending = [];
        effects.forEach((run) => run());
      };
      render();
      const view = {
        get raw() {
          return raw;
        },
        get tree() {
          return expand(raw);
        },
        rerender(next) {
          props = next;
          render();
        },
        async flush() {
          for (let round = 0; round < 50; round += 1) {
            await new Promise((resolve) => setImmediate(resolve));
            if (!dirty) return view;
            render();
          }
          throw new Error("render did not settle");
        },
      };
      return view;
    },
  };
}

function findAll(node, predicate, out = []) {
  if (Array.isArray(node)) node.forEach((child) => findAll(child, predicate, out));
  else if (node && typeof node === "object") {
    if (predicate(node)) out.push(node);
    findAll(node.children, predicate, out);
  }
  return out;
}
const text = (node) =>
  node == null || typeof node === "boolean"
    ? ""
    : typeof node === "string" || typeof node === "number"
      ? String(node)
      : Array.isArray(node)
        ? node.map(text).join("")
        : text(node.children);
const byClass = (tree, name) =>
  findAll(tree, (n) =>
    String(n.props?.className || "")
      .split(" ")
      .includes(name),
  );

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

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  return {
    setTimeout(fn, ms = 0) {
      const id = next++;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, t]) => t.at <= end)
          .sort((x, y) => x[1].at - y[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = end;
    },
  };
}

test("成功提示：焦点与悬停交替进出后，悬停期间提示不会被遗留计时关掉", async () => {
  const runtime = createRuntime();
  const clock = fakeClock();
  const { Notices } = loadComponents(runtime.react, {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const dismissed = [];
  const stack = Notices({
    notices: [{ id: "n1", tone: "success", text: "已保存" }],
    onDismiss: (id) => dismissed.push(id),
  });
  const toast = findAll(stack, (n) => typeof n.type === "function" && n.props.notice)[0];
  const view = runtime.mount(toast.type, toast.props);
  const box = () => view.raw.props;
  box().onFocus();
  box().onMouseEnter();
  box().onBlur();
  box().onMouseLeave();
  box().onMouseEnter();
  clock.advance(10000);
  assert.deepEqual(dismissed, []);
  box().onMouseLeave();
  clock.advance(10000);
  assert.deepEqual(dismissed, ["n1"]);
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
