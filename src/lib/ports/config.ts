// @ts-nocheck
/**
 * PortConfig — thresholds and default soft/hard policy switches.
 * Change policy knobs here; tools should call getPortConfig().
 */
import { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD, } from "../store.js";
const DEFAULTS = {
    briefRecentMs: BRIEF_RECENT_MS,
    saveBypassWordThreshold: SAVE_BYPASS_WORD_THRESHOLD,
    defaultStrictLint: false,
    defaultRequirePayoff: false,
    defaultStrictHuman: false,
    defaultStrictNovel: false,
    defaultEditMode: "polish-depolish",
    multiDraftEnabled: false,
};
let current = { ...DEFAULTS };
export function getPortConfig() {
    return current;
}
/** Test / plugin apply hook — shallow replace known keys. */
export function setPortConfig(patch) {
    current = { ...current, ...patch };
    return current;
}
export function resetPortConfig() {
    current = { ...DEFAULTS };
    return current;
}
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD };
