/// <reference types="vite/client" />
import type { DesktopBridge } from "../shared/ipc";

declare global {
  interface Window {
    /** preload 暴露的类型化桥（只有 invoke 与 subscribe）。 */
    zhizhangBridge?: DesktopBridge;
  }
}

export {};
