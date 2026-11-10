import assert from "node:assert/strict";
import test from "node:test";
import { fitZoom, ZOOM_MAX } from "../../apps/desktop/out-test/zoom.mjs";

test("窗口缩放：默认及更小的窗口保持 1 倍，靠响应式布局", () => {
  assert.equal(fitZoom(1380, 860), 1);
  assert.equal(fitZoom(1366, 728), 1);
  assert.equal(fitZoom(760, 650), 1);
  assert.equal(fitZoom(0, 0), 1);
  assert.equal(fitZoom(Number.NaN, 900), 1);
});

test("窗口缩放：最大化与全屏时按较小的比例等比放大，不留大片空白", () => {
  // 1920×1080 全屏：宽比 1.39、高比 1.42，取 1.39 → 1.4
  assert.equal(fitZoom(1920, 1080), 1.4);
  // 1920×1032 最大化（扣任务栏与标题栏）：高比 1.358 → 1.35
  assert.equal(fitZoom(1920, 1032), 1.35);
  // 2560×1400：受上限约束
  assert.equal(fitZoom(2560, 1400), ZOOM_MAX);
  // 超宽屏高度不够时以高度为准，纵向仍放得下
  assert.equal(fitZoom(3440, 1000), 1.3);
  for (const [w, h] of [
    [1920, 1032],
    [2560, 1400],
    [3440, 1000],
    [1600, 860],
  ]) {
    const z = fitZoom(w, h);
    assert.ok(h / z >= 760 - 20, `${w}×${h} 放大后可用高度不足：${h / z}`);
  }
});
