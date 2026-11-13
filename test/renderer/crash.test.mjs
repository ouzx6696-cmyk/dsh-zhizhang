import test from "node:test";
import assert from "node:assert/strict";
import { loadRenderer } from "../engine/helpers.mjs";
import { byClass, createRuntime, findAll, text } from "../engine/runtime.mjs";

/** 渲染层包配一个记下 console.error 与重新加载次数的窗口。 */
function crashFixture() {
  const runtime = createRuntime();
  const logged = [];
  const reloads = [];
  const renderer = loadRenderer(runtime.react, {
    window: { writerBridge: {}, location: { reload: () => reloads.push(1) } },
    console: { error: (...args) => logged.push(args) },
  });
  return { runtime, renderer, logged, reloads };
}

test("根部错误边界：子组件渲染抛错时显示错误摘要与重新加载按钮，原始错误进控制台", async () => {
  const f = crashFixture();
  const h = f.runtime.react.createElement;
  let broken = false;
  const RendererError = f.renderer.reportUnhandledRejection.constructor("return Error")();
  function Page() {
    if (broken) throw new RendererError("组件坏了");
    return h("main", null, "正文");
  }
  const view = f.runtime.mount(() => h(f.renderer.RootErrorBoundary, null, h(Page)));
  assert.equal(text(view.tree), "正文");
  broken = true;
  view.rerender({});
  const [alert] = findAll(view.tree, (n) => n.props.role === "alert");
  assert.ok(alert, "应渲染兜底画面而不是空白");
  assert.match(text(alert), /界面出错了/);
  assert.equal(text(findAll(alert, (n) => n.type === "p")[0]), "组件坏了");
  assert.equal(f.logged[0][0].message, "组件坏了");
  const [reload] = findAll(alert, (n) => n.type === "button");
  assert.equal(text(reload), "重新加载窗口");
  reload.props.onClick();
  assert.equal(f.reloads.length, 1);
});

test("未处理的 Promise 失败：发一条含原因的 danger 提示，原始错误进控制台，不拦截默认报错", async () => {
  const f = crashFixture();
  const view = f.runtime.mount(f.renderer.NoticeStack, { label: "提示" });
  // 错误要来自渲染层包自己的 realm，像浏览器里一样能被 instanceof Error 认出来。
  const RendererError = f.renderer.reportUnhandledRejection.constructor("return Error")();
  const reason = new RendererError("probe");
  const event = {
    reason,
    preventDefault: () => assert.fail("不应 preventDefault"),
  };
  f.renderer.reportUnhandledRejection(event);
  f.renderer.reportUnhandledRejection({ ...event, reason: "纯文字原因" });
  await view.flush();
  const notices = byClass(view.tree, "ui-notice");
  assert.deepEqual(
    notices.map((n) => [n.props["data-tone"], text(findAll(n, (c) => c.type === "p"))]),
    [
      ["danger", "后台操作失败：probe"],
      ["danger", "后台操作失败：纯文字原因"],
    ],
  );
  assert.equal(f.logged[0][0], reason);
});
