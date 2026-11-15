import { contextBridge, ipcRenderer, webFrame } from "electron";
import type { DesktopEvent } from "./shared/events.js";
import type { DesktopBridge } from "./shared/ipc.js";
import { fitZoom } from "./main/zoom.js";

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

/** 只暴露类型化调用与事件订阅；通道名一律加 "zhizhang:" 前缀，与主进程注册一致。 */
const bridge: DesktopBridge = {
  invoke: (channel, ...args) => ipcRenderer.invoke(`zhizhang:${channel}`, ...args),
  subscribe: (callback) => {
    const listener = (_event: unknown, value: DesktopEvent) => callback(value);
    ipcRenderer.on("zhizhang:event", listener);
    return () => ipcRenderer.removeListener("zhizhang:event", listener);
  },
};

contextBridge.exposeInMainWorld("zhizhangBridge", bridge);
