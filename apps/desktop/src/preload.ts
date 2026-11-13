import type { DesktopBridge } from "./ipc-result";
import type { DesktopEvent } from "./renderer-contracts";
import { contextBridge, ipcRenderer, webFrame } from "electron";
import { fitZoom } from "./main/zoom";

// 外观选“等比放大”时，最大化、全屏或拖大窗口按窗口等比放大界面（见 main/zoom.ts）；
// 其余布局保持 1 倍，宽屏由 CSS 自适应铺开。渲染层把选项写在 <html data-layout>，DOM 与页面共享。
// 以渲染层实际视口换算回未缩放尺寸来算，不依赖主进程 resize 事件里可能滞后的窗口尺寸。
const fitWindowZoom = () => {
  const current = webFrame.getZoomFactor();
  const next =
    document.documentElement.dataset.layout === "zoom"
      ? fitZoom(window.innerWidth * current, window.innerHeight * current)
      : 1;
  if (Math.abs(next - current) > 0.001) webFrame.setZoomFactor(next);
};
window.addEventListener("resize", fitWindowZoom);
window.addEventListener("DOMContentLoaded", () => {
  fitWindowZoom();
  new MutationObserver(fitWindowZoom).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-layout"],
  });
});

const bridge: DesktopBridge = {
  invoke: (name, ...args) => ipcRenderer.invoke("writer:" + name, ...args),
  subscribe: (callback) => {
    const listener = (_event: unknown, value: DesktopEvent) => callback(value);
    ipcRenderer.on("writer:event", listener);
    return () => ipcRenderer.removeListener("writer:event", listener);
  },
};
contextBridge.exposeInMainWorld("writerBridge", bridge);
