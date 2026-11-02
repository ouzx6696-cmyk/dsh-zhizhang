import { createDesktopAdapter } from "./desktop.js";
import type { DesktopBridge } from "./types.js";
export { ApiError } from "./types.js";
export type { WorkbenchData } from "./types.js";
const bridge = (globalThis as typeof globalThis & { window: { writerDesktop: DesktopBridge } }).window.writerDesktop;
export const dataAdapter = createDesktopAdapter(bridge);
