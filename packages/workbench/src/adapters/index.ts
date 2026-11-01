import { createDshAdapter } from "./dsh.js";
import { createDesktopAdapter } from "./desktop.js";
import type { DesktopBridge, WorkbenchData } from "./types.js";

export { ApiError } from "./types.js";
export type { WorkbenchData } from "./types.js";
export { readToken, writeToken } from "./dsh.js";

const bridge = (globalThis as { window?: { writerDesktop?: DesktopBridge } }).window?.writerDesktop;
export const dataAdapter: WorkbenchData = bridge
  ? createDesktopAdapter(bridge)
  : createDshAdapter();
