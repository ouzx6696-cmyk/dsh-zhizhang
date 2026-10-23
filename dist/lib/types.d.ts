/**
 * On-disk + in-memory types for dsh-zhizhang. No Postgres.
 *
 * 这些是「落盘契约」的类型：meta.json / ledger.json / 候选文件都按这里的形状读写。
 * 需要动态 JSON 的地方（拆书产物、卡模块）显式用 Record<string, any>，不要用隐式 any。
 */
export declare const SCHEMA_VERSION = 1;
/** Five diagnostic evidence kinds for AI review *output* (agent-side; ledger stores them). */
export declare const REVIEW_EVIDENCE_KINDS: string[];
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
    foundation: Foundation;
    createdAt: string;
    updatedAt: string;
    chapters: ChapterMeta[];
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
    lintHitCount?: number;
    /** 已扫过的凭据（只证明扫过，不等于过关） */
    lintPassToken?: string;
    lintedAt?: string;
    /** 编辑稿指向源候选 */
    editOf?: string;
    /** 统一整理稿指向多个父候选 */
    unifyOf?: string[];
    draftLabel?: string;
    variantGroup?: string;
    editMode?: string;
    editedAt?: string;
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
    multiDraftEnabled?: boolean;
    multiDraft?: {
        enabled?: boolean;
    };
    [key: string]: unknown;
}
/** 工具执行上下文（DSH 传入；这里只声明插件实际用到的部分）。 */
export interface ExecContext {
    /** 宿主 Agent 上下文；结构由 DSH 决定，插件只按需取用（session.cwd / ctx）。 */
    agent?: any;
    [key: string]: any;
}
export declare const EMPTY_FOUNDATION: () => Foundation;
export declare const EMPTY_OUTLINE: () => Outline;
export declare const CHAPTER_STATUSES: ChapterStatus[];
