/**
 * PortConfig — thresholds and default soft/hard policy switches.
 * Change policy knobs here; tools should call getPortConfig().
 */
import { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "../store.js";
export declare function getPortConfig(): {
    briefRecentMs: number;
    saveBypassWordThreshold: number;
    defaultStrictLint: boolean;
    defaultRequirePayoff: boolean;
    defaultStrictHuman: boolean;
    defaultStrictNovel: boolean;
    defaultEditMode: string;
    multiDraftEnabled: boolean;
};
/** Test / plugin apply hook — shallow replace known keys. */
export declare function setPortConfig(patch: any): {
    briefRecentMs: number;
    saveBypassWordThreshold: number;
    defaultStrictLint: boolean;
    defaultRequirePayoff: boolean;
    defaultStrictHuman: boolean;
    defaultStrictNovel: boolean;
    defaultEditMode: string;
    multiDraftEnabled: boolean;
};
export declare function resetPortConfig(): {
    briefRecentMs: number;
    saveBypassWordThreshold: number;
    defaultStrictLint: boolean;
    defaultRequirePayoff: boolean;
    defaultStrictHuman: boolean;
    defaultStrictNovel: boolean;
    defaultEditMode: string;
    multiDraftEnabled: boolean;
};
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD };
