/**
 * PortConfig — thresholds and default soft/hard policy switches.
 * Change policy knobs here; tools should call getPortConfig().
 */
import {
  BRIEF_RECENT_MS,
  SAVE_BYPASS_WORD_THRESHOLD,
} from "../store.js";

export interface PortConfig {
  /** Window for recent brief / payoff lookups on accept. */
  briefRecentMs: number;
  /** chapter_save body over this needs confirm_bypass. */
  saveBypassWordThreshold: number;
  /** Default for accept strict_lint (ban-list as hard law). Keep false. */
  defaultStrictLint: boolean;
  /** Default for accept require_payoff. Keep false (soft warn). */
  defaultRequirePayoff: boolean;
  /** Default for accept strict_human (范文腔 soft radar as hard law). Keep false. */
  defaultStrictHuman: boolean;
  /** Default for accept strict_novel (书感 soft radar as hard law). Keep false. */
  defaultStrictNovel: boolean;
}

const DEFAULTS: PortConfig = {
  briefRecentMs: BRIEF_RECENT_MS,
  saveBypassWordThreshold: SAVE_BYPASS_WORD_THRESHOLD,
  defaultStrictLint: false,
  defaultRequirePayoff: false,
  defaultStrictHuman: false,
  defaultStrictNovel: false,
};

let current: PortConfig = { ...DEFAULTS };

export function getPortConfig(): PortConfig {
  return current;
}

/** Test / plugin apply hook — shallow replace known keys. */
export function setPortConfig(patch: Partial<PortConfig>): PortConfig {
  current = { ...current, ...patch };
  return current;
}

export function resetPortConfig(): PortConfig {
  current = { ...DEFAULTS };
  return current;
}

export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD };
