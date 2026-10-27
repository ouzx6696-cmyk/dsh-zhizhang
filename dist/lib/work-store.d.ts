import type { Candidate, ExecContext, PluginConfig, StoragePaths } from "./types.js";
/** 面板用的项目摘要。 */
interface ProjectSummary {
    id: string;
    base: string;
    /** 该项目实际使用的作品根；面板切项目时不能拿全局 config.worksRoot 猜。 */
    worksRoot?: string;
    name?: string;
    lastUsedAt?: string;
    exists?: boolean;
    works?: {
        key: string;
        title: string;
        genre?: string;
        chapters: number | null;
        wordCount: number | null;
        updatedAt?: string;
        recoveryPending?: boolean;
    }[];
    worksCount?: number | null;
    error?: string;
    chapters?: number | null;
    words?: number | null;
    recoveryPending?: boolean;
}
export { readLedger, appendLedger, LEDGER_MAX_ENTRIES } from "./storage/ledger.js";
export { atomicWrite, assertResourceId, countWords, withLock } from "./storage/primitives.js";
export { listChapters, readChapter, saveChapter, setOutline, updateChapter } from "./storage/chapters.js";
export { readWorkMeta, writeWorkMeta } from "./storage/work-meta.js";
export declare function slugify(title: string): string;
export declare function sessionCwd(exec: ExecContext | null): string;
export declare function rememberToolBase(base: string, works: string): void;
export declare function getLastToolBase(): string;
/** Read the persisted marker (cached in memory after the first hit). */
export declare function loadLastToolBase(): Promise<any>;
/** Stable id for a workspace storage root (case/sep-insensitive). */
export declare function projectIdOf(base: string): string;
/**
 * Record this workspace in the cross-project index (best-effort, serialized).
 * Called from ensureStorage for tool calls only, so the panel can list projects.
 */
export declare function rememberProject(base: string, works: string): void;
/** List candidate book files in a local shelf folder (read-only, no import). */
export declare function listLocalBooks(sourceRoot: any, opts?: any): Promise<{
    name: string;
    title: string;
    path: string;
    bytes: number;
}[]>;
/**
 * Known workspaces with a cheap per-project summary (works/chapters/words).
 * Summaries are derived from each project's own .zhizhang — never authoritative copies.
 */
export declare function listProjects(opts?: any): Promise<ProjectSummary[] | {
    error?: string | undefined;
    id: any;
    base: string;
    worksRoot: any;
    name: any;
    lastUsedAt: any;
    exists: boolean;
    works: {
        key: any;
        title: any;
        genre: any;
        chapters: any;
        wordCount: any;
        updatedAt: any;
        recoveryPending: boolean;
    }[];
    worksCount: number | null;
    chapters: number | null;
    words: number | null;
    recoveryPending: boolean;
}[]>;
export declare function storagePaths(exec: ExecContext | null, config: PluginConfig, workingDir: any): {
    base: any;
    works: string;
    manuscripts: string;
    library: string;
    inspiration: string;
    sourceRoot: string;
};
export declare function ensureStorage(exec: ExecContext | null, config: PluginConfig, workingDir?: any): Promise<StoragePaths>;
export declare function workDir(paths: StoragePaths, key: string): string;
/** Recency window for brief / payoff soft·hard checks on accept (12h). */
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "./domain/constants.js";
/** chapter_save: body over this word count needs confirm_bypass=true. */
export declare function createWork(paths: StoragePaths, input: any): Promise<{
    meta: {
        schemaVersion: number;
        key: string;
        title: any;
        genre: any;
        premise: any;
        foundation: import("./types.js").Foundation;
        createdAt: string;
        updatedAt: string;
        chapters: never[];
    };
    dir: string;
}>;
export declare function listWorks(paths: StoragePaths): Promise<any[]>;
export declare function resolveWorkDir(paths: StoragePaths, keyOrTitle: any): Promise<string>;
export declare function setFoundation(dir: string, patch: any, options?: {
    pace?: string;
}): Promise<any>;
/** Update a chapter outcome under the work lock, preserving all other author-written text. */
export declare function appendHappenedLine(dir: string, chapterId: string, line: string, replace?: boolean): Promise<{
    meta: any;
    appended: boolean;
    line: string;
    reason: string;
    replaced?: undefined;
} | {
    meta: any;
    appended: boolean;
    replaced: boolean;
    line: string;
    reason?: undefined;
} | {
    meta: any;
    appended: boolean;
    line: string;
    reason?: undefined;
    replaced?: undefined;
}>;
/** Persist candidate JSON without dropping optional multi-draft / edit fields. */
export declare function candidateToDiskMeta(cand: any): Candidate;
export declare function stageCandidate(dir: string, input: any): Promise<Candidate>;
export declare function readCandidate(dir: string, candidateId: string): Promise<any>;
/**
 * Record that style_lint ran on a staged candidate and issue lintPassToken.
 * Token proves the sensor ran (hitCount may be > 0) — NOT a quality pass.
 * Replaces any prior scan. Adoption can also scan inline; existing credentials must remain valid.
 */
export declare function markCandidateLinted(dir: string, candidateId: string, hitCount: any, expectedBody?: string): Promise<{
    token: string;
    lintedAt: string;
    hitCount: any;
    chapterId: any;
}>;
/** True when candidate has a lint pass recorded at/after stagedAt. */
export declare function candidateHasLintPass(cand: any): boolean;
/** Bind policy evaluation to the exact candidate later committed. */
export declare function candidateGateFingerprint(cand: any): string;
/**
 * Accept a staged candidate into the chapter draft. Explicit tool only —
 * never called implicitly by generation. Replaces or appends body per mode.
 *
 * Refuse rules (engineering gate — not AI judgment):
 * - already-accepted candidate → refuse (stage a new one)
 * - no recorded scan → scan inline; stale recorded scan → refuse
 * - lintPassToken provided but mismatches → refuse
 * - target chapter status is final → refuse unless force=true
 */
export declare function acceptCandidate(dir: string, candidateId: string, mode?: any, opts?: any): Promise<any>;
export declare function listCandidates(dir: string): Promise<any[]>;
export declare function readBriefCrumbs(dir: string): Promise<any>;
export declare function recordBriefBreadcrumb(dir: string, input: any): Promise<{
    chapterId: any;
    at: string;
    assetIds: any[];
    basis: any;
}>;
/** Most recent brief for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export declare function getRecentBrief(dir: string, chapterId: string, maxAgeMs?: any): Promise<any>;
export declare function readPayoffAudits(dir: string): Promise<any>;
export declare function storePayoffAudit(dir: string, entry: any): Promise<any>;
export declare function getLastPayoffAudit(dir: string, chapterId: string): Promise<any>;
/** Most recent payoff audit for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export declare function getRecentPayoffAudit(dir: string, chapterId: string, maxAgeMs?: any): Promise<any>;
export declare function assembleManuscript(dir: string, paths: StoragePaths, opts?: any): Promise<{
    file: string;
    words: number;
    chapters: number;
}>;
export declare function removeWorkDir(dir: string): Promise<void>;
