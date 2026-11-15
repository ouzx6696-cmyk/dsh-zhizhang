import { contextBridge, ipcRenderer, webFrame } from "electron";
import type { DesktopEvent } from "./shared/events.js";
import type { DesktopBridge } from "./shared/ipc.js";

const ZOOM_BASE = { width: 1380, height: 760 } as const;
const ZOOM_MAX = 1.75;

function fitZoom(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const ratio = Math.min(width / ZOOM_BASE.width, height / ZOOM_BASE.height);
  const clamped = Math.min(ZOOM_MAX, Math.max(1, ratio));
  return Math.round(clamped * 20) / 20;
}

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
  invoke: (channel, ...args) => ipcRenderer.invoke(`zhizhang:${channel}`, ...args),
  subscribe: (callback) => {
    const listener = (_event: unknown, value: DesktopEvent) => callback(value);
    ipcRenderer.on("zhizhang:event", listener);
    return () => ipcRenderer.removeListener("zhizhang:event", listener);
  },
};

contextBridge.exposeInMainWorld("zhizhangBridge", bridge);
