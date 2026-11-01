/**
 * Data facade reachable from the pure view components. The adapter is chosen
 * once: IPC in the desktop client, HTTP when the panel runs inside DSH.
 */
import { dataAdapter } from "../../adapters/index.js";

export { ApiError, readToken, writeToken } from "../../adapters/index.js";

export const fanqie = dataAdapter.fanqie;
export const toutiao = dataAdapter.toutiao;
export const profilesApi = (mode) => dataAdapter.profiles(mode);

// Kept for components that still name the 0.9.3 exports.
export const api = fanqie;
export const toutiaoApi = toutiao;
