export declare const METHOD_ASSET_IDS: any[];
export declare function listMethodAssets(): {
    id: string;
    title: string;
    whenToUse: string;
}[];
export declare function getMethodAsset(id: string): any;
export declare function getMethodAssets(ids: any): {
    found: any[];
    missing: string[];
};
/** Default packs pulled by zhizhang_chapter_brief for drafting. */
/** Lean default: style only. novel_sense/draft/tomato via method_get or brief_mode=full. */
export declare const CHAPTER_BRIEF_ASSET_IDS: string[];
/** Full brief pack (explicit brief_mode=full). */
export declare const CHAPTER_BRIEF_FULL_ASSET_IDS: string[];
export declare function formatAssetForAgent(asset: any): string;
/** Truncate long foundation fields for brief injection. */
export declare function truncateForBrief(text: string, max?: any): string;
/** Soft max for pathological chapter length; typical chapters inject in full. */
export declare const PREV_CHAPTER_BODY_SOFT_MAX = 16000;
/**
 * Resolve previous-chapter prose for brief injection.
 * Prefers `body` (full); falls back to `bodyTail` for legacy callers.
 */
export declare function resolvePreviousBody(prev: any): {
    text: any;
    clipped: boolean;
    source: string;
};
/**
 * Top-of-brief「本书读者合同」— book identity for the drafting agent.
 * For n≥2, previous chapter **body** is primary; ending + happened are indexes.
 */
export declare function formatReaderContract(input: any): string;
