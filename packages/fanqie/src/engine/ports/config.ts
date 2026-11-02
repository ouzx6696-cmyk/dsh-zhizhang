/**
 * PortConfig — thresholds and default soft/hard policy switches.
 * Change policy knobs here; tools should call getPortConfig().
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "../domain/constants.js";
const scoped = new AsyncLocalStorage<PortConfig>();
export function withPortConfig<T>(patch: Partial<PortConfig>, run: () => T): T {
  return scoped.run({ ...DEFAULTS, ...patch }, run);
}
const DEFAULTS = {
  briefRecentMs: BRIEF_RECENT_MS,
  saveBypassWordThreshold: SAVE_BYPASS_WORD_THRESHOLD,
  defaultStrictLint: false,
  defaultRequirePayoff: false,
  defaultStrictHuman: false,
  defaultStrictNovel: false,
  defaultEditMode: "polish-depolish",
  multiDraft: { enabled: false },
};
type PortConfig = typeof DEFAULTS;
export function getPortConfig(): PortConfig {
  return scoped.getStore() ?? DEFAULTS;
}
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD };
