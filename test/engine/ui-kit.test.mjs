import test from "node:test";
import assert from "node:assert/strict";
import { loadComponents } from "./helpers.mjs";
import { createRuntime, findAll, plain } from "./runtime.mjs";

// —— keys.ts：平台在模块加载时读取，每种平台各加载一份组件包 ——

test("快捷键标注：macOS 上 Ctrl 显示为 ⌘，其它写法不变", () => {
  const { shortcutLabel } = loadComponents(createRuntime().react, {
    navigator: { platform: "MacIntel" },
  });
  assert.equal(shortcutLabel("Ctrl K"), "⌘K");
  assert.equal(shortcutLabel("Ctrl+Shift+P"), "⌘Shift+P");
  assert.equal(shortcutLabel("Ctrl + S"), "⌘S");
  assert.equal(shortcutLabel("Esc"), "Esc");
});

test("快捷键标注：Windows 与 Linux 上原样显示", () => {
  for (const platform of ["Win32", "Linux x86_64"]) {
    const { shortcutLabel } = loadComponents(createRuntime().react, { navigator: { platform } });
    assert.equal(shortcutLabel("Ctrl K"), "Ctrl K", platform);
  }
});

// —— tabs.tsx ——

const ITEMS = [
  { id: "a", label: "甲" },
  { id: "b", label: "乙", disabled: true },
  { id: "c", label: "丙" },
  { id: "d", label: "丁" },
];

function tabsFixture(props = {}) {
  const runtime = createRuntime();
  const focused = [];
  const document = { getElementById: (id) => ({ focus: () => focused.push(id) }) };
  const { TabList, tabPanelProps } = loadComponents(runtime.react, { document });
  const changes = [];
  const base = { id: "set", label: "设置", items: ITEMS, value: "a", ...props };
  const view = runtime.mount(TabList, { ...base, onChange: (tab) => changes.push(tab) });
  const tabs = () => findAll(view.tree, (n) => n.props.role === "tab");
  const press = (key) => {
    const event = { key, prevented: false, preventDefault: () => (event.prevented = true) };
    view.tree.props.onKeyDown(event);
    return event;
  };
  return { tabPanelProps, view, tabs, press, changes, focused };
}

test("标签页：只有当前标签进 Tab 键序，选中与禁用状态写在属性上", () => {
  const f = tabsFixture({ value: "c" });
  const tabs = f.tabs();
  assert.deepEqual(
    tabs.map((tab) => tab.props.tabIndex),
    [-1, -1, 0, -1],
  );
  assert.deepEqual(
    tabs.map((tab) => tab.props["aria-selected"]),
    [false, false, true, false],
  );
  assert.equal(tabs[1].props.disabled, true);
  assert.equal(tabs[2].props.id, "set-tab-c");
  assert.equal(tabs[2].props["aria-controls"], "set-panel-c");
  assert.equal(f.view.tree.props["aria-orientation"], "horizontal");
});

test("标签页：→ 跳过禁用项切到下一个并移动焦点，末尾回到开头", () => {
  const f = tabsFixture({ value: "a" });
  assert.equal(f.press("ArrowRight").prevented, true);
  assert.deepEqual(f.changes, ["c"]);
  assert.deepEqual(f.focused, ["set-tab-c"]);
  const last = tabsFixture({ value: "d" });
  last.press("ArrowRight");
  assert.deepEqual(last.changes, ["a"]);
});

test("标签页：← 向前切换并回绕，Home/End 跳到首尾可用项", () => {
  const f = tabsFixture({ value: "a" });
  f.press("ArrowLeft");
  f.press("End");
  f.press("Home");
  assert.deepEqual(f.changes, ["d", "d", "a"]);
  const c = tabsFixture({ value: "c" });
  c.press("ArrowLeft");
  assert.deepEqual(c.changes, ["a"]);
});

test("标签页：横排时 ↑/↓ 与其它按键不处理，也不拦截默认行为", () => {
  const f = tabsFixture();
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "a"])
    assert.equal(f.press(key).prevented, false);
  assert.deepEqual(f.changes, []);
});

test("标签页：竖排时用 ↑/↓ 切换，←/→ 不处理", () => {
  const f = tabsFixture({ orientation: "vertical", value: "c" });
  assert.equal(f.view.tree.props["aria-orientation"], "vertical");
  f.press("ArrowDown");
  f.press("ArrowUp");
  assert.equal(f.press("ArrowRight").prevented, false);
  assert.deepEqual(f.changes, ["d", "a"]);
});

test("标签页：当前值不在可用项里时，→ 从第一个可用项开始，← 从最后一个开始", () => {
  const f = tabsFixture({ value: "b" });
  f.press("ArrowRight");
  f.press("ArrowLeft");
  assert.deepEqual(f.changes, ["a", "d"]);
});

test("标签页：点击切换但不额外移动焦点", () => {
  const f = tabsFixture();
  f.tabs()[3].props.onClick();
  assert.deepEqual(f.changes, ["d"]);
  assert.deepEqual(f.focused, []);
});

test("标签面板：与标签共用 id 前缀，非当前面板隐藏", () => {
  const { tabPanelProps } = tabsFixture();
  assert.deepEqual(plain(tabPanelProps("set", "c", "c")), {
    id: "set-panel-c",
    role: "tabpanel",
    "aria-labelledby": "set-tab-c",
    hidden: false,
  });
  assert.equal(tabPanelProps("set", "a", "c").hidden, true);
});
