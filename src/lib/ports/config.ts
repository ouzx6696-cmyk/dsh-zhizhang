/**
 * PortConfig — thresholds and default soft/hard policy switches.
 * Change policy knobs here; tools should call getPortConfig().
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "../domain/constants.js";
const scoped = new AsyncLocalStorage<Record<string, any>>();
export function withPortConfig<T>(patch: Record<string, any>, run: () => T): T {
    return scoped.run({ ...current, ...patch }, run);
}
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
    return scoped.getStore() ?? current;
}
/** Test / plugin apply hook — shallow replace known keys. */
export function setPortConfig(patch: any) {
    current = { ...current, ...patch };
    return current;
}
export function resetPortConfig() {
    current = { ...DEFAULTS };
    return current;
}
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD };
