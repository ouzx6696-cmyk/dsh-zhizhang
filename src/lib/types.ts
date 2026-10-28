/**
 * On-disk + in-memory types for dsh-zhizhang. No Postgres.
 *
 * 这些是「落盘契约」的类型：meta.json / ledger.json / 候选文件都按这里的形状读写。
 * 需要动态 JSON 的地方（拆书产物、卡模块）显式用 Record<string, any>，不要用隐式 any。
 */
export const SCHEMA_VERSION = 1;
/** Five diagnostic evidence kinds for AI review *output* (agent-side; ledger stores them). */
export const REVIEW_EVIDENCE_KINDS = [
    "结构与锁定/伏笔咬合",
    "视角处境与注意力偏见",
    "亲历博弈充实度",
    "AI腔与心理偷懒诊断",
    "章末落点质感",
];
export interface Foundation {
    /** 作者锁定：不得违背的世界/人物设定 */
    locks: string;
    /** 已发生事实（按章累积） */
    happened: string;
    /** 人物卡摘要 */
    characters: string;
    /** 读者已知 */
    readerKnowledge: string;
    /** 计划中未发生 */
    planned: string;
    /** 未结伏笔 */
    threads: string;
    /** 全书文风约束 */
    style: string;
}

export interface Outline {
    pov: string;
    targetWords: number;
    locks: string;
    knowledge: string;
    synopsis: string;
    conflict: string;
    beats: string;
    ending: string;
    situationLens: string;
    livedScene: string;
    stateLens: string;
}

export type ChapterStatus = "planned" | "drafting" | "drafted" | "reviewed" | "final";

export interface ChapterMeta {
    id: string;
    title: string;
    position: number;
    status: ChapterStatus;
    wordCount: number;
    outline: Outline;
    createdAt: string;
    updatedAt: string;
}

export interface WorkMeta {
    schemaVersion: number;
    key: string;
    title: string;
    genre: string;
    premise: string;
    /** Explicitly selected pacing; absent in legacy or undecided works. */
    pace?: "快爽" | "稳推" | "慢燃";
    foundation: Foundation;
    createdAt: string;
    updatedAt: string;
    chapters: ChapterMeta[];
    planning?: { schemaVersion: 1; book?: { content: string; [key: string]: unknown }; volumes: Array<{ id: string; content: string; chapters: string[]; [key: string]: unknown }>; acts?: Array<{ id: string; content: string; chapters: string[]; [key: string]: unknown }>; [key: string]: unknown };
    continuity?: { schemaVersion: 1; finalized: Array<{ chapterId: string; revision: string; excerpt: string; at: string }>; working: Array<{ chapterId: string; revision: string; excerpt: string; at: string }> };
}

export interface LedgerEntry {
    at: string;
    chapter?: string;
    kind: string;
    summary?: string;
    [key: string]: unknown;
}

export interface Ledger {
    schemaVersion: number;
    workKey: string;
    entries: LedgerEntry[];
}

export interface Candidate {
    schemaVersion: number;
    id: string;
    workKey: string;
    chapterId: string;
    stagedAt: string;
    source: string;
    note: string;
    body: string;
    bodyFile: string;
    wordCount: number;
    /** 语感雷达命中数（style_lint 写入） */
    targetRevision?: string;
    basis?: import("./domain/lifecycle.js").ContextBasis;
    lintHitCount?: number;
    /** 已扫过的凭据（只证明扫过，不等于过关） */
    lintPassToken?: string;
    /** Hash of the exact candidate text that was scanned. */
    lintBodyHash?: string;
    lintedAt?: string;
    /** 编辑稿指向源候选 */
    editOf?: string;
    /** 统一整理稿指向多个父候选 */
    unifyOf?: string[];
    draftLabel?: string;
    variantGroup?: string;
    editMode?: string;
    editedAt?: string;
    revisionSource?: { requestId: string; digest: string; pace: string | null; source?: import("./domain/diagnostics.js").DiagnosticSource };
    acceptedAt?: string;
    acceptedMode?: string;
}

export interface StoragePaths {
    /** 存储根：manuscripts / inspiration / 默认 works、library */
    base: string;
    /** 作品目录：一本书一个同名文件夹 */
    works: string;
    manuscripts: string;
    /** 拆书库：index.json + sources/ + cards/ */
    library: string;
    inspiration: string;
    /** 本地书源目录（可空） */
    sourceRoot: string;
    /** 内部：解析来源标记（panel / agent 等） */
    resolvedVia?: string;
}

export interface PluginConfig {
    rootDir?: string;
    storageRoot?: string;
    worksRoot?: string;
    libraryRoot?: string;
    sourceRoot?: string;
    allowLanPanel?: boolean;
    /** LAN panel: allowed Host values（hostname 或 host:port）；缺省 = 本机各网卡地址。 */
    panelHosts?: string[];
    /** LAN panel: 共享令牌；设置后请求须带 Bearer 或 X-zhizhang-token。 */
    panelToken?: string;
    multiDraftEnabled?: boolean;
    multiDraft?: { enabled?: boolean };
    [key: string]: unknown;
}

/** 工具执行上下文（DSH 传入；这里只声明插件实际用到的部分）。 */
export interface ExecContext {
    /** 宿主 Agent 上下文；结构由 DSH 决定，插件只按需取用（session.cwd / ctx）。 */
    agent?: any;
    [key: string]: any;
}

export const EMPTY_FOUNDATION = (): Foundation => ({
    locks: "",
    happened: "",
    characters: "",
    readerKnowledge: "",
    planned: "",
    threads: "",
    style: "",
});
export const EMPTY_OUTLINE = (): Outline => ({
    pov: "",
    targetWords: 2500,
    locks: "",
    knowledge: "",
    synopsis: "",
    conflict: "",
    beats: "",
    ending: "",
    situationLens: "",
    livedScene: "",
    stateLens: "",
});
export const CHAPTER_STATUSES: ChapterStatus[] = [
    "planned",
    "drafting",
    "drafted",
    "reviewed",
    "final",
];
