import { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "../domain/constants.js";
export declare function withPortConfig<T>(patch: Record<string, any>, run: () => T): T;
export declare function getPortConfig(): Record<string, any> | {
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
