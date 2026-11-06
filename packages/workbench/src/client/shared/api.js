/** Data facade for the desktop preload bridge. */
import { dataAdapter } from "../../adapters/index.js";

export const fanqie = dataAdapter.fanqie;
export const toutiao = dataAdapter.toutiao;
export const profilesApi = (mode) => dataAdapter.profiles(mode);
