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
  continuity: { enabled: false },
  /** 1.1.1 B 类开关，默认开：定稿章结构变更须 force。 */
  finalStructureGuard: true,
  /** 1.1.1 B 类开关，默认开：灵感会话只以规划字段为依据。 */
  narrowPlanningBasis: true,
};
type PortConfig = typeof DEFAULTS;
export function getPortConfig(): PortConfig {
  return scoped.getStore() ?? DEFAULTS;
}
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD };
