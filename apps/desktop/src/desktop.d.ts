import type { desktopAPI } from "./preload";
declare global {
  interface Window {
    writerDesktop: typeof desktopAPI;
  }
}
export {};
