/**
 * PortConfig — thresholds and default soft/hard policy switches.
 * Change policy knobs here; tools should call getPortConfig().
 */
import { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "../store.js";
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
    /** Default polish mode for optional edit pass. */
    defaultEditMode: string;
    /**
     * Optional multi-draft + unify. Default false.
     * Staging N candidates always OK; unify_brief / unify_stage require true
     * (or env DSH_ZHIZHANG_MULTI_DRAFT=1).
     */
    multiDraftEnabled: boolean;
}
export declare function getPortConfig(): PortConfig;
/** Test / plugin apply hook — shallow replace known keys. */
export declare function setPortConfig(patch: Partial<PortConfig>): PortConfig;
export declare function resetPortConfig(): PortConfig;
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD };
