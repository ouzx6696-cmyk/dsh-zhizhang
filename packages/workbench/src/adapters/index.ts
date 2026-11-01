import { createDshAdapter } from "./dsh.js";
import { createDesktopAdapter } from "./desktop.js";
import type { DesktopBridge, WorkbenchData } from "./types.js";

export { ApiError } from "./types.js";
export type { WorkbenchData } from "./types.js";
export { readToken, writeToken, TOKEN_KEY } from "./dsh.js";

export function createDataAdapter(bridge?: DesktopBridge): WorkbenchData {
  return bridge ? createDesktopAdapter(bridge) : createDshAdapter();
}

const bridge = (globalThis as { window?: { writerDesktop?: DesktopBridge } }).window?.writerDesktop;
export const dataAdapter = createDataAdapter(bridge);
