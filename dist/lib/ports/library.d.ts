import { type StoragePaths } from "../store.js";
export type PillarStatus = "live" | "reserved";
export interface LibraryCapability {
    id: string;
    title: string;
    ready: boolean;
}
export interface MechanismSpec {
    name: string;
    experience: string;
    rebuild: string;
    discard: string;
    failWhen: string;
}
/** 双轴：写作技法 | 创作思维（0.7.0 硬字段） */
export type CardAxis = "craft" | "mind";
/**
 * 活人证据（归 craft）：作家写法 + 场面角色状态。
 * characterState = 场面状态（写法+状态）；非台词范本/人设墙。
 * 0.10.5：反僵硬 = 抽打碎逻辑(A–G)+本书载体（迁逻辑不迁场面外壳）。
 */
export interface HumanFeelSpec {
    /** 作家写法：叙述口吻、场面取舍、信息怎么漏、节奏/小物；可写打碎逻辑名+本书载体 */
    writerCraft: string;
    /** 写法证据出处 / 阅读范围 */
    craftRange: string;
    /** 这一刻场面状态（慌、赖皮、在算账、会错半拍…），非声纹、非人设清单 */
    characterState: string;
    /** 状态落到纸上的手法（身体、偏题、半截话等）——写法层 */
    stateOnPage: string;
    /** 本场应落纸的不完美（打碎正向句 + 本书载体）；勿写「可以/允许…」许可句 */
    allowedEdges: string;
    /** 僵硬范文版即失败：句句收齐 / 反应全对 / 讲义说明 / 意义被收完 */
    failAsTemplate: string;
}
/** Shatter-logic cues (A–G) — book-agnostic anti-stiffness language on craft cards. */
export declare const SHATTER_CRAFT_CUE_RE: RegExp;
/** Soft-warn: allowedEdges still written as permission ("可以/允许…"). */
export declare const PERMISSION_EDGE_RE: RegExp;
export declare const DEFAULT_FAIL_AS_TEMPLATE = "\u5199\u6210\u53E5\u53E5\u6536\u9F50\u3001\u53CD\u5E94\u5168\u5BF9\u3001\u8BF4\u660E\u6BB5\u8BB2\u4E49\u3001\u610F\u4E49\u88AB\u4F5C\u8005\u6536\u5B8C\u7684\u50F5\u786C\u8303\u6587\u5373\u5931\u8D25";
/** One-line anti-stiffness cue appended to lean brief when craft promises shatter. */
export declare const ANTI_STIFFNESS_BRIEF_LINE = "\u672C\u573A\u53CD\u50F5\u786C\uFF1A\u6309\u5361\u4E0A\u7684\u6253\u788E\u903B\u8F91\u5199\u2014\u2014\u547C\u5438\u53EF\u4E0D\u4E00\u3001\u5FF5\u5934\u53EF\u7559\u534A\u622A\u3001\u4FE1\u606F\u53EF\u4FA7\u6F0F\u3001\u53CD\u5E94\u53EF\u5148\u9519\uFF1B\u529F\u80FD\u62CD\u540E\u53EF\u7559\u4F59\u9707\uFF1B\u522B\u628A\u610F\u4E49\u6536\u6210\u5408\u683C\u8303\u6587\u3002";
export declare function hasShatterCraftCue(...parts: Array<string | undefined | null>): boolean;
/**
 * 书感/续写面（归 craft · 方案 A）：章级「继续为何」。
 * 不是完整创作思维；长线债/换压见 MindSpec。
 */
export interface BookCraftSpec {
    continueWhy: string;
    adjacentChange?: string;
    failAsShortStory?: string;
}
/**
 * 创作思维证据（归 mind）：指向设定 / 章纲 / 卷纲，不是句级口吻。
 */
export interface MindSpec {
    /** 卖点如何进能力与代价 */
    sellIntoCost: string;
    /** 信息如何分期交付 */
    infoStaging: string;
    /** 人物关系如何当压力机 */
    pressureMachine: string;
    /** 长线债与换压（章/卷） */
    debtAndSwap: string;
    /** 读者合同如何立 */
    readerContract: string;
    /** 写成百科/设定表/梗概即失败 */
    failAsEncyclopedia: string;
}
/** 旧版 AnalysisHandoff 四项（可选；两轴可用） */
export interface AnalysisHandoff {
    purpose: string;
    experience: string;
    rebuild: string;
    discard: string;
}
/** 次标签（场面粒度）；axis=mind 才进创作思维轨 */
export type TechniqueCardKind = "craft" | "scene" | "book";
export interface TechniqueCard {
    schemaVersion: 1;
    id: string;
    title: string;
    sourceId: string;
    readingRange: string;
    /** 0.7.0 硬轴：craft | mind */
    axis: CardAxis;
    mechanisms: MechanismSpec[];
    /** craft：写法+状态 */
    humanFeel?: HumanFeelSpec;
    /** craft：章级续写面 */
    bookCraft?: BookCraftSpec;
    /** mind：创作思维 */
    mind?: MindSpec;
    handoff?: AnalysisHandoff;
    /** 可选次标签；≠ axis */
    kind?: TechniqueCardKind;
    body: string;
    tags: string[];
    status: "drafted" | "accepted";
    createdAt: string;
    updatedAt: string;
    acceptedAt?: string;
}
export interface LibrarySourceMeta {
    schemaVersion: 1;
    id: string;
    title: string;
    author: string;
    readingRange: string;
    excerptPath: string;
    charCount: number;
    createdAt: string;
    updatedAt: string;
}
export interface LibraryIndex {
    schemaVersion: 1;
    sources: Array<{
        id: string;
        title: string;
        author: string;
        createdAt: string;
    }>;
    cards: Array<{
        id: string;
        title: string;
        sourceId: string;
        tags: string[];
        status: "drafted" | "accepted";
        updatedAt: string;
        /** 0.7.0；旧 index 可缺 */
        axis?: CardAxis;
    }>;
}
export type CardRow = LibraryIndex["cards"][number];
/** list / search 过滤：按书、按轴 */
export interface CardAuditRow {
    id: string;
    title: string;
    axis: CardAxis;
    evidenceQuotes: number;
    evidenceVerified: number;
    unverifiable: string[];
    skippedShort: string[];
    located: string[];
    chapterOk: boolean | null;
    warnings: string[];
}

export declare function auditCardContent(card: TechniqueCard & {
    axis?: CardAxis;
}, sourceText: string, normSourceCache?: string): Omit<CardAuditRow, "id" | "title" | "axis">;

export interface CardQueryOpts {
    status?: "accepted" | "drafted" | "all";
    /** 单本来源 */
    sourceId?: string;
    /** 多本来源（与 sourceId 并集） */
    sourceIds?: string[];
    /** 书名/作者子串（不区分大小写）→ 解析为 sourceId 集合 */
    sourceTitle?: string;
    /** craft | mind */
    axis?: CardAxis;
    /** 标签精确过滤（如 战斗 / 都市高武） */
    tag?: string;
}
export interface ComboSuggestInput {
    /** 限制候选池到来源（可跨书；空=全库已采纳） */
    sourceIds?: string[];
    /** 书名/作者子串过滤候选池 */
    sourceTitle?: string;
    /** 技法张数 N（默认 2，夹在 1–8） */
    craftCount?: number;
    /** 主题检索：给 mind/craft 打分排序 */
    query?: string;
    /** 优先从这些 source 抽 mind；池内不够再回落 */
    preferMindSourceIds?: string[];
}
export interface ComboCardRef {
    id: string;
    title: string;
    sourceId: string;
    axis: CardAxis;
    tags: string[];
}
export interface ComboSuggestResult {
    ok: boolean;
    /** 恰好 1 mind + ≤N craft 的 id 列表（mind 在前） */
    cardIds: string[];
    mind: ComboCardRef | null;
    crafts: ComboCardRef[];
    warnings: string[];
    emptyReason?: string;
}
export interface StageCardInput {
    title: string;
    sourceId: string;
    readingRange?: string;
    /** craft | mind；缺则兼容推断 */
    axis?: CardAxis | string;
    mechanisms: MechanismSpec[];
    humanFeel?: HumanFeelSpec | Record<string, unknown>;
    bookCraft?: BookCraftSpec | Record<string, unknown>;
    mind?: MindSpec | Record<string, unknown>;
    handoff?: AnalysisHandoff | Record<string, unknown>;
    kind?: TechniqueCardKind | string;
    body: string;
    tags?: string[];
}
export interface StageCardResult {
    candId: string;
    title: string;
    warnings: string[];
}
/**
 * Normalize optional humanFeel. Missing block → soft warn, card still stages.
 * Accepts 0.6 writerCraft/characterState shape AND legacy voice/realness shape.
 * Never hard-reject for migration.
 */
export declare function normalizeHumanFeel(raw: unknown): {
    humanFeel?: HumanFeelSpec;
    warnings: string[];
};
/** Coerce on-disk / in-memory humanFeel that may still be legacy voice shape. */
export declare function coerceHumanFeel(raw: HumanFeelSpec | Record<string, unknown> | undefined): HumanFeelSpec | undefined;
export declare function craftCueFromHumanFeel(hf: HumanFeelSpec | Record<string, unknown> | undefined): string;
/** Format humanFeel for forge / brief / card_get. Missing → thin craft/state note. */
export declare function formatHumanFeelBlock(hf: HumanFeelSpec | Record<string, unknown> | undefined): string;
/**
 * Normalize optional bookCraft. Missing → soft warn; never hard-reject.
 */
export declare function normalizeBookCraft(raw: unknown): {
    bookCraft?: BookCraftSpec;
    warnings: string[];
};
/** Format bookCraft for forge / brief / card_get. */
export declare function formatBookCraftBlock(bc: BookCraftSpec | undefined): string;
/**
 * Normalize optional handoff four-tuple. Missing → soft warn only.
 */
export declare function normalizeHandoff(raw: unknown): {
    handoff?: AnalysisHandoff;
    warnings: string[];
};
export declare function formatHandoffBlock(h: AnalysisHandoff | undefined): string;
export declare function normalizeKind(raw: unknown): {
    kind?: TechniqueCardKind;
    warnings: string[];
};
/**
 * Normalize / infer axis. Missing → soft warn + default craft (compat).
 * kind=book never becomes mind.
 */
export declare function normalizeAxis(raw: unknown, hints?: {
    hasHumanFeel?: boolean;
    hasMind?: boolean;
    hasBookCraft?: boolean;
    tags?: string[];
    kind?: string;
}): {
    axis: CardAxis;
    warnings: string[];
};
/** Coerce on-disk card axis for reads (never throw). */
export declare function coerceAxis(card: Partial<TechniqueCard> | Record<string, unknown>): CardAxis;
/**
 * Normalize optional mind block. Missing → soft warn for mind-axis callers.
 */
export declare function normalizeMind(raw: unknown): {
    mind?: MindSpec;
    warnings: string[];
};
export declare function formatMindBlock(mind: MindSpec | undefined): string;
/** Soft warn if characterState looks like a personality wall. */
export declare function warnCharacterStateWall(state: string | undefined): string[];
/**
 * Strip negation / disclaimer contexts that mention 声纹 without teaching voice.
 * Fixes false positive on「非声纹」「≠角色声纹」etc. (0.10.0).
 */
export declare function neutralizeVoiceNegations(text: string): string;
/** Collect short snippets around regex hits for reject receipts. */
export declare function collectAdmitHits(hay: string, re: RegExp, limit?: number): string[];
/**
 * Admission: hard-reject obvious encyclopedia / voice-teaching / plot-summary cards.
 * Soft path otherwise. Voice checks ignore negation disclaimers (非声纹…).
 */
export declare function admitCardContent(input: {
    title: string;
    body: string;
    axis: CardAxis;
    mechanisms: MechanismSpec[];
}): {
    hardReject?: string;
    warnings: string[];
};
/**
 * Full card inject block. Branches by axis.
 * craft: humanFeel + bookCraft + mechanisms
 * mind: mind + mechanisms（规划向）
 */
export declare function formatModuleBlockV2(card: TechniqueCard & Record<string, unknown>): string;
export declare function formatTechniqueCardBlock(card: TechniqueCard): string;
/**
 * Lean block for chapter_brief：**仅 craft**。
 * mind 卡返回一行提示，不整段灌句式/规划正文。
 */
export declare function formatTechniqueCardBlockLean(card: TechniqueCard): string;
export declare const LibraryPort: {
    id: "port.library";
    status: PillarStatus;
    title: string;
    summary: string;
    capabilities(): LibraryCapability[];
    ensureLibrary(paths: StoragePaths): Promise<StoragePaths>;
    importSource(paths: StoragePaths, input: {
        title: string;
        author?: string;
        text?: string;
        file?: string;
        readingRange?: string;
        exec?: unknown;
    }): Promise<{
        sourceId: string;
        charCount: number;
        excerptPath: string;
        encoding?: string;
        converted?: boolean;
        warning?: string;
    }>;
    getSource(paths: StoragePaths, sourceId: string): Promise<{
        meta: LibrarySourceMeta;
        text: string;
    }>;
    listSources(paths: StoragePaths): Promise<LibraryIndex["sources"]>;
    dissectBrief(paths: StoragePaths, sourceId: string, opts?: {
        maxChars?: number;
        includeRecommend?: boolean;
    }): Promise<string>;
    stageCard(paths: StoragePaths, input: StageCardInput): Promise<StageCardResult>;
    acceptCard(paths: StoragePaths, candId: string): Promise<{
        cardId: string;
        title: string;
        warnings?: string[];
        judgment?: string[];
    }>;
    listCards(paths: StoragePaths, opts?: CardQueryOpts): Promise<CardRow[]>;
    searchCards(paths: StoragePaths, query: string, opts?: CardQueryOpts): Promise<CardRow[]>;
    /**
     * 推荐组合包：恰好 1 mind + 最多 N craft（可跨 source）。
     * 缺 mind → ok=false + emptyReason（不抛，便于产品面展示）。
     */
    suggestCombo(paths: StoragePaths, input?: ComboSuggestInput): Promise<ComboSuggestResult>;
    auditCards(paths: StoragePaths, opts?: {
        cardId?: string;
        sourceId?: string;
        axis?: CardAxis;
        status?: "accepted" | "drafted" | "all";
    }): Promise<CardAuditRow[]>;
    getCard(paths: StoragePaths, cardId: string): Promise<TechniqueCard>;
    getCandidate(paths: StoragePaths, candId: string): Promise<TechniqueCard>;
};
