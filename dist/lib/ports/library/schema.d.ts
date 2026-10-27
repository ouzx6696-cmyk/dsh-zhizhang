/** Shatter-logic cues (A–G) — book-agnostic anti-stiffness language on craft cards. */
export declare const SHATTER_CRAFT_CUE_RE: RegExp;
/** Soft-warn: allowedEdges still written as permission ("可以/允许…"). */
export declare const PERMISSION_EDGE_RE: RegExp;
export declare const DEFAULT_FAIL_AS_TEMPLATE = "\u5199\u6210\u53E5\u53E5\u6536\u9F50\u3001\u53CD\u5E94\u5168\u5BF9\u3001\u8BF4\u660E\u6BB5\u8BB2\u4E49\u3001\u610F\u4E49\u88AB\u4F5C\u8005\u6536\u5B8C\u7684\u50F5\u786C\u8303\u6587\u5373\u5931\u8D25";
/** One-line anti-stiffness cue appended to lean brief when craft promises shatter. */
export declare const ANTI_STIFFNESS_BRIEF_LINE = "\u672C\u573A\u53CD\u50F5\u786C\uFF1A\u6309\u5361\u4E0A\u7684\u6253\u788E\u903B\u8F91\u5199\u2014\u2014\u547C\u5438\u53EF\u4E0D\u4E00\u3001\u5FF5\u5934\u53EF\u7559\u534A\u622A\u3001\u4FE1\u606F\u53EF\u4FA7\u6F0F\u3001\u53CD\u5E94\u53EF\u5148\u9519\uFF1B\u529F\u80FD\u62CD\u540E\u53EF\u7559\u4F59\u9707\uFF1B\u522B\u628A\u610F\u4E49\u6536\u6210\u5408\u683C\u8303\u6587\u3002";
export declare function hasShatterCraftCue(...parts: any[]): boolean;
export declare function normalizeMechanism(raw: any, i: number): {
    name: string;
    experience: string;
    rebuild: string;
    discard: string;
    failWhen: string;
};
/**
 * Normalize optional humanFeel. Missing block → soft warn, card still stages.
 * Accepts 0.6 writerCraft/characterState shape AND legacy voice/realness shape.
 * Never hard-reject for migration.
 */
export declare function normalizeHumanFeel(raw: any): {
    warnings: string[];
    humanFeel?: undefined;
} | {
    humanFeel: {
        writerCraft: string;
        craftRange: string;
        characterState: string;
        stateOnPage: string;
        allowedEdges: string;
        failAsTemplate: string;
    };
    warnings: string[];
};
/** Coerce on-disk / in-memory humanFeel that may still be legacy voice shape. */
export declare function coerceHumanFeel(raw: any): {
    writerCraft: string;
    craftRange: string;
    characterState: string;
    stateOnPage: string;
    allowedEdges: string;
    failAsTemplate: string;
} | undefined;
export declare function craftCueFromHumanFeel(hf: any): string;
/** Format humanFeel for forge / brief / card_get. Missing → thin craft/state note. */
export declare function formatHumanFeelBlock(hf: any): string;
/**
 * Normalize optional bookCraft. Missing → soft warn; never hard-reject.
 */
export declare function normalizeBookCraft(raw: any): {
    warnings: string[];
    bookCraft?: undefined;
} | {
    bookCraft: {
        continueWhy: string;
        adjacentChange?: string;
        failAsShortStory?: string;
    };
    warnings: string[];
};
/** Format bookCraft for forge / brief / card_get. */
export declare function formatBookCraftBlock(bc: any): string;
/**
 * Normalize optional handoff four-tuple. Missing → soft warn only.
 */
export declare function normalizeHandoff(raw: any): {
    warnings: string[];
    handoff?: undefined;
} | {
    handoff: {
        purpose: string;
        experience: string;
        rebuild: string;
        discard: string;
    };
    warnings: string[];
};
export declare function formatHandoffBlock(h: any): string;
export declare function normalizeKind(raw: any): {
    warnings: string[];
    kind?: undefined;
} | {
    kind: string;
    warnings: string[];
};
/**
 * Normalize / infer axis. Missing → soft warn + default craft (compat).
 * kind=book never becomes mind.
 */
export declare function normalizeAxis(raw: any, hints?: any): {
    axis: string;
    warnings: string[];
};
/** Coerce on-disk card axis for reads (never throw). */
export declare function coerceAxis(card: any): any;
/**
 * Normalize optional mind block. Missing → soft warn for mind-axis callers.
 */
export declare function normalizeMind(raw: any): {
    warnings: string[];
    mind?: undefined;
} | {
    mind: {
        sellIntoCost: string;
        infoStaging: string;
        pressureMachine: string;
        debtAndSwap: string;
        readerContract: string;
        failAsEncyclopedia: string;
    };
    warnings: string[];
};
export declare function formatMindBlock(mind: any): string;
/** Soft warn if characterState looks like a personality wall. */
export declare function warnCharacterStateWall(state: any): string[];
/**
 * Strip negation / disclaimer contexts that mention 声纹 without teaching voice.
 * Fixes false positive on「非声纹」「≠角色声纹」etc. (0.10.0).
 */
export declare function neutralizeVoiceNegations(text: string): string;
/** Collect short snippets around regex hits for reject receipts. */
export declare function collectAdmitHits(hay: any, re: any, limit?: number): any[];
/**
 * Admission: hard-reject obvious encyclopedia / voice-teaching / plot-summary cards.
 * Soft path otherwise. Voice checks ignore negation disclaimers (非声纹…).
 */
/** 读没读的痕迹：证据段、章号、设计决策/检验方法、写法段。只是形状检查，真读仍需人判。 */
export declare function readingArtifactWarnings(body: string, axis: any): string[];
export declare function admitCardContent(input: any): {
    hardReject: string;
    warnings: string[];
} | {
    warnings: string[];
    hardReject?: undefined;
};
/**
 * Full card inject block. Branches by axis.
 * craft: humanFeel + bookCraft + mechanisms
 * mind: mind + mechanisms（规划向）
 */
export declare function formatModuleBlockV2(card: any): string;
export declare function formatTechniqueCardBlock(card: any): string;
/**
 * Lean block for chapter_brief：**仅 craft**。
 * mind 卡返回一行提示，不整段灌句式/规划正文。
 */
export declare function formatTechniqueCardBlockLean(card: any): string;
