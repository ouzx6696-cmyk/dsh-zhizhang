export interface MethodAsset {
    /** Stable id for tool pull. */
    id: string;
    title: string;
    /** One-line cue for zhizhang_method_list. */
    whenToUse: string;
    /** Full method text for injection into agent context. */
    body: string;
}
export declare const METHOD_ASSET_IDS: readonly string[];
export declare function listMethodAssets(): Array<Pick<MethodAsset, "id" | "title" | "whenToUse">>;
export declare function getMethodAsset(id: string): MethodAsset | undefined;
export declare function getMethodAssets(ids: string[]): {
    found: MethodAsset[];
    missing: string[];
};
/** Default packs pulled by zhizhang_chapter_brief for drafting. */
/** Lean default: style only. novel_sense/draft/tomato via method_get or brief_mode=full. */
export declare const CHAPTER_BRIEF_ASSET_IDS: readonly ["style_contract"];
/** Full brief pack (explicit brief_mode=full). */
export declare const CHAPTER_BRIEF_FULL_ASSET_IDS: readonly ["novel_sense", "style_contract", "draft", "tomato_four_q"];
export declare function formatAssetForAgent(asset: MethodAsset): string;
/** Truncate long foundation fields for brief injection. */
export declare function truncateForBrief(text: string, max?: number): string;
/** Soft max for pathological chapter length; typical chapters inject in full. */
export declare const PREV_CHAPTER_BODY_SOFT_MAX = 16000;
export interface ReaderContractPrevious {
    id: string;
    title: string;
    ending: string;
    /** Optional short outline summary (situation / lived). */
    summary?: string;
    /**
     * Previous chapter body — primary continuity for n≥2.
     * Prefer full (or near-full) text; ending/happened are indexes only.
     */
    body?: string;
    /** @deprecated Prefer `body`. Kept for callers that only have a short tail. */
    bodyTail?: string;
}
export interface ReaderContractInput {
    premise: string;
    planned: string;
    threads: string;
    happened?: string;
    chapterEnding?: string;
    /** n≥2 previous chapter; null/undefined = opening or unknown. */
    previous?: ReaderContractPrevious | null;
    /** Soft warnings rendered under the contract (e.g. missing prev / thin 落点). */
    warnings?: string[];
    /** True when this brief is for chapter position ≥2. */
    continuation?: boolean;
    /** lean: shorter planned/threads; n≥2 still injects previous chapter body. */
    lean?: boolean;
    /** @deprecated lean/full both inject previous body when present; kept for API compat. */
    includePrevTail?: boolean;
}
/**
 * Resolve previous-chapter prose for brief injection.
 * Prefers `body` (full); falls back to `bodyTail` for legacy callers.
 */
export declare function resolvePreviousBody(prev: ReaderContractPrevious): {
    text: string;
    clipped: boolean;
    source: "body" | "bodyTail" | "empty";
};
/**
 * Top-of-brief「本书读者合同」— book identity for the drafting agent.
 * For n≥2, previous chapter **body** is primary; ending + happened are indexes.
 */
export declare function formatReaderContract(input: ReaderContractInput): string;
