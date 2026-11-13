/** The single renderer boundary for the preload bridge. */
import { createDesktopApi } from "../../desktop-api";
export type { DesktopApi } from "../../desktop-api";
import type { DesktopApi } from "../../desktop-api";
export const desktop = createDesktopApi(window.writerBridge);
window.writerDesktop = desktop;

type DesktopEventListener = Parameters<DesktopApi["subscribe"]>[0];
const listeners = new Set<DesktopEventListener>();
let detach: (() => void) | undefined;

/** 渲染层只挂一条 IPC 订阅再扇出：每条事件只跨 contextBridge 复制一次。 */
export function onDesktopEvent(listener: DesktopEventListener) {
  listeners.add(listener);
  detach ??= desktop.subscribe((value) => {
    for (const current of listeners) current(value);
  });
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0 || !detach) return;
    detach();
    detach = undefined;
  };
}
