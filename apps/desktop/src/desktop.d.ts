import type { DesktopBridge } from "./shared/ipc.js";

declare global {
  interface Window {
    zhizhangBridge: DesktopBridge;
  }
}

export {};
