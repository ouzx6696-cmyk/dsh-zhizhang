import test from "node:test";
import assert from "node:assert/strict";
import { loadComponents } from "./helpers.mjs";
import { byClass, createRuntime, fakeClock, findAll, text } from "./runtime.mjs";

/** 焦点目标：只有登记在提示里的节点才算“仍在提示内”。 */
class FakeNode {}

/**
 * 每个用例一份全新的组件包，提示队列是模块级单例，不能从上一个用例继承。
 * 计时与 Date.now 都走同一只假时钟。
 */
function noticeFixture() {
  const runtime = createRuntime();
  const clock = fakeClock();
  const ui = loadComponents(runtime.react, {
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    Date: clock.Date,
    Node: FakeNode,
  });
  const view = runtime.mount(ui.NoticeStack, { label: "提示" });
  const items = () => byClass(view.tree, "ui-notice");
  const only = () => {
    const [item] = items();
    assert.ok(item, "提示应仍在");
    return item;
  };
  const inside = new FakeNode();
  const focusEvent = (relatedTarget = null) => ({
    relatedTarget,
    currentTarget: { contains: (node) => node === inside },
  });
  const act = async (handler, event) => {
    only().props[handler](event);
    await view.flush();
  };
  const advance = async (ms) => {
    clock.advance(ms);
    await view.flush();
  };
  return { ui, view, items, only, act, advance, inside, focusEvent };
}

test("提示队列：前一个用例留下的提示", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "warning", text: "留在队列里" });
  await f.view.flush();
  assert.equal(f.items().length, 1);
});

test("提示队列：每个用例拿到新的模块实例，开头队列为空", async () => {
  const f = noticeFixture();
  assert.equal(f.items().length, 0);
});

test("提示队列：同色同文只留最新一条，最多同时显示五条", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "info", text: "重复" });
  f.ui.notify({ tone: "warning", text: "重复" });
  f.ui.notify({ tone: "info", text: "重复" });
  await f.view.flush();
  assert.equal(f.items().length, 2);
  for (let index = 0; index < 6; index += 1) f.ui.notify({ tone: "warning", text: `第${index}条` });
  await f.view.flush();
  const shown = f.items().map((item) => text(item.children[1].children[0]));
  assert.deepEqual(shown, ["第1条", "第2条", "第3条", "第4条", "第5条"]);
});

test("提示队列：错误与警告进 alert 分区，成功与信息进 status 分区", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "success", text: "已保存" });
  f.ui.notify({ tone: "danger", text: "写入失败" });
  await f.view.flush();
  const [alert] = findAll(f.view.tree, (n) => n.props.role === "alert");
  const [status] = findAll(f.view.tree, (n) => n.props.role === "status");
  assert.equal(byClass(alert, "ui-notice")[0].props["data-tone"], "danger");
  assert.equal(byClass(status, "ui-notice")[0].props["data-tone"], "success");
});

test("提示队列：dismissNotice 关一条，dismissNotices 按类别收起", async () => {
  const f = noticeFixture();
  const first = f.ui.notify({ tone: "danger", text: "甲" });
  f.ui.notify({ tone: "danger", text: "乙" });
  f.ui.notify({ tone: "info", text: "丙" });
  f.ui.dismissNotice(first);
  await f.view.flush();
  assert.equal(f.items().length, 2);
  f.ui.dismissNotices("danger");
  await f.view.flush();
  assert.deepEqual(
    f.items().map((item) => item.props["data-tone"]),
    ["info"],
  );
});

test("提示：多行文字第一行作标题，其余折进详情；显式 detail 优先", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "danger", text: "保存失败\n  磁盘已满  " });
  await f.view.flush();
  assert.equal(text(findAll(f.only(), (n) => n.type === "p")), "保存失败");
  assert.equal(text(findAll(f.only(), (n) => n.type === "pre")), "磁盘已满");
  f.ui.dismissNotices("danger");
  f.ui.notify({ tone: "warning", text: "一行\n二行", detail: "" });
  await f.view.flush();
  assert.equal(text(findAll(f.only(), (n) => n.type === "p")), "一行\n二行");
  assert.equal(findAll(f.only(), (n) => n.type === "details").length, 0);
});

test("提示：动作按钮执行后收起这条提示，关闭按钮直接收起", async () => {
  const f = noticeFixture();
  let runs = 0;
  f.ui.notify({ tone: "danger", text: "失败", action: { label: "重试", run: () => (runs += 1) } });
  await f.view.flush();
  byClass(f.only(), "ui-notice-action")[0].props.onClick();
  await f.view.flush();
  assert.equal(runs, 1);
  assert.equal(f.items().length, 0);
  f.ui.notify({ tone: "warning", text: "注意" });
  await f.view.flush();
  byClass(f.only(), "ui-notice-close")[0].props.onClick();
  await f.view.flush();
  assert.equal(f.items().length, 0);
});

test("提示计时：成功提示 4 秒后自己收起，警告与错误不自动收起", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "success", text: "已保存" });
  f.ui.notify({ tone: "danger", text: "失败" });
  await f.view.flush();
  await f.advance(3999);
  assert.equal(f.items().length, 2);
  await f.advance(1);
  assert.deepEqual(
    f.items().map((item) => item.props["data-tone"]),
    ["danger"],
  );
  await f.advance(60_000);
  assert.equal(f.items().length, 1);
});

test("提示计时：悬停时暂停，离开后按剩余时间继续", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "info", text: "信息" });
  await f.view.flush();
  await f.advance(3000);
  await f.act("onMouseEnter");
  await f.advance(10_000);
  assert.equal(f.items().length, 1);
  await f.act("onMouseLeave");
  await f.advance(999);
  assert.equal(f.items().length, 1);
  await f.advance(1);
  assert.equal(f.items().length, 0);
});

test("提示计时：聚焦→悬停→失焦后鼠标仍在提示上，推进 10 秒不收起", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "success", text: "已保存" });
  await f.view.flush();
  await f.act("onFocus");
  await f.act("onMouseEnter");
  await f.act("onBlur", f.focusEvent());
  await f.advance(10_000);
  assert.equal(f.items().length, 1);
  await f.act("onMouseLeave");
  await f.advance(4000);
  assert.equal(f.items().length, 0);
});

test("提示计时：悬停→聚焦→移开鼠标后焦点仍在提示上，推进 10 秒不收起；失焦后才继续", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "success", text: "已保存" });
  await f.view.flush();
  await f.act("onMouseEnter");
  await f.act("onFocus");
  await f.act("onMouseLeave");
  await f.advance(10_000);
  assert.equal(f.items().length, 1);
  await f.act("onBlur", f.focusEvent());
  await f.advance(10_000);
  assert.equal(f.items().length, 0);
});

test("提示计时：聚焦→悬停→失焦→离开→再悬停，推进 10 秒不收起", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "info", text: "信息" });
  await f.view.flush();
  await f.act("onFocus");
  await f.act("onMouseEnter");
  await f.act("onBlur", f.focusEvent());
  await f.act("onMouseLeave");
  await f.act("onMouseEnter");
  await f.advance(10_000);
  assert.equal(f.items().length, 1);
});

test("提示计时：焦点移到提示内的按钮不算离开，计时仍暂停", async () => {
  const f = noticeFixture();
  f.ui.notify({ tone: "success", text: "已保存", action: { label: "撤销", run() {} } });
  await f.view.flush();
  await f.act("onFocus");
  await f.act("onBlur", f.focusEvent(f.inside));
  await f.advance(10_000);
  assert.equal(f.items().length, 1);
  await f.act("onBlur", f.focusEvent(new FakeNode()));
  await f.advance(4000);
  assert.equal(f.items().length, 0);
});
