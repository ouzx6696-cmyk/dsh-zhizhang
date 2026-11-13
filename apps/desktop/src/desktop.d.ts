import type { DesktopApi } from "./desktop-api";
import type { DesktopBridge } from "./ipc-result";
declare global {
  interface Window {
    writerDesktop: DesktopApi;
    writerBridge: DesktopBridge;
  }
}
export {};
