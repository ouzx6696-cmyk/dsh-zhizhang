import { type BriefBreadcrumb, type BriefCrumbFile, type CandidateFile, type ChapterMeta, type ChapterRecord, type ChapterStatus, type Foundation, type LedgerEntry, type LedgerFile, type Outline, type PayoffAuditFile, type PayoffAuditStored, type WorkMeta } from "./types.js";
import type { PanelInspirationView, PanelLibraryView, PanelProductView } from "./panel-enrich.js";
export declare function withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
export declare function countWords(text: string): number;
export declare function slugify(title: string): string;
export declare function assertResourceId(id: unknown, label?: string): string;
export declare function sessionCwd(exec: unknown): string;
export declare function rememberToolBase(base: string, works?: string): void;
export declare function getLastToolBase(): string;
/** Read the persisted marker (cached in memory after the first hit). */
export declare function loadLastToolBase(): Promise<string>;
/** Stable id for a workspace storage root (case/sep-insensitive). */
export declare function projectIdOf(base: string): string;
/**
 * Record this workspace in the cross-project index (best-effort, serialized).
 * Called from ensureStorage for tool calls only, so the panel can list projects.
 */
export declare function rememberProject(base: string, works?: string): void;
export interface LocalBook {
    name: string;
    title: string;
    path: string;
    bytes: number;
}
/** List candidate book files in a local shelf folder (read-only, no import). */
export declare function listLocalBooks(sourceRoot: string | undefined, opts?: {
    limit?: number;
}): Promise<LocalBook[]>;
export interface ProjectSummary {
    id: string;
    base: string;
    name: string;
    lastUsedAt: string;
    exists: boolean;
    works: Array<{
        key: string;
        title: string;
        genre: string;
        chapters: number;
        wordCount: number;
        updatedAt: string;
    }>;
    worksCount: number;
    chapters: number;
    words: number;
}
/**
 * Known workspaces with a cheap per-project summary (works/chapters/words).
 * Summaries are derived from each project's own .zhizhang — never authoritative copies.
 */
export declare function listProjects(opts?: {
    ttl?: number;
    refresh?: boolean;
}): Promise<ProjectSummary[]>;
export interface StoragePaths {
    base: string;
    works: string;
    manuscripts: string;
    library: string;
    inspiration: string;
    /** Optional local book shelf (config.sourceRoot / DSH_ZHIZHANG_SOURCE_ROOT). */
    sourceRoot: string;
}
export interface StorageConfig {
    rootDir?: string;
    storageRoot?: string;
    worksRoot?: string;
    libraryRoot?: string;
    sourceRoot?: string;
}
export declare function storagePaths(exec: unknown, config: StorageConfig | undefined, workingDir?: string): StoragePaths;
export declare function ensureStorage(exec: unknown, config: StorageConfig | undefined, workingDir?: string): Promise<StoragePaths>;
export declare function atomicWrite(file: string, content: string): Promise<void>;
export declare function workDir(paths: StoragePaths, key: string): string;
/** Recency window for brief / payoff soft·hard checks on accept (12h). */
export declare const BRIEF_RECENT_MS: number;
/** chapter_save: body over this word count needs confirm_bypass=true. */
export declare const SAVE_BYPASS_WORD_THRESHOLD = 200;
export declare function createWork(paths: StoragePaths, input: {
    title: string;
    genre?: string;
    premise?: string;
    key?: string;
}): Promise<{
    meta: WorkMeta;
    dir: string;
}>;
export declare function listWorks(paths: StoragePaths): Promise<WorkMeta[]>;
export declare function readWorkMeta(dir: string): Promise<WorkMeta>;
export declare function writeWorkMeta(dir: string, meta: WorkMeta): Promise<void>;
export declare function resolveWorkDir(paths: StoragePaths, keyOrTitle: string): Promise<string>;
export declare function listChapters(dir: string): Promise<ChapterMeta[]>;
export declare function readChapter(dir: string, chapterId: string): Promise<ChapterRecord>;
export declare function saveChapter(dir: string, input: {
    id?: string;
    title: string;
    body: string;
    position?: number;
    status?: ChapterStatus;
    outline?: Partial<Outline>;
}): Promise<ChapterRecord>;
export declare function setOutline(dir: string, chapterId: string, patch: Partial<Outline>): Promise<ChapterRecord>;
export declare function setFoundation(dir: string, patch: Partial<Foundation>): Promise<WorkMeta>;
export declare function readLedger(dir: string): Promise<LedgerFile>;
export declare function appendLedger(dir: string, entry: Omit<LedgerEntry, "id" | "at"> & {
    id?: string;
    at?: string;
}): Promise<LedgerEntry>;
/** Persist candidate JSON without dropping optional multi-draft / edit fields. */
export declare function candidateToDiskMeta(cand: CandidateFile): Record<string, unknown>;
export declare function stageCandidate(dir: string, input: {
    chapterId: string;
    body: string;
    note?: string;
    source?: "agent" | "import" | "edit" | "unify";
    editOf?: string;
    editMode?: string;
    draftLabel?: string;
    variantGroup?: string;
    unifyOf?: string[];
}): Promise<CandidateFile>;
export declare function readCandidate(dir: string, candidateId: string): Promise<CandidateFile>;
/**
 * Record that style_lint ran on a staged candidate and issue lintPassToken.
 * Token proves the sensor ran (hitCount may be > 0) — NOT a quality pass.
 * Clears any prior token. Accept still requires the token; hitCount is echoed / optional strict.
 */
export declare function markCandidateLinted(dir: string, candidateId: string, hitCount: number): Promise<{
    token: string;
    lintedAt: string;
    hitCount: number;
    chapterId: string;
}>;
/** True when candidate has a lint pass recorded at/after stagedAt. */
export declare function candidateHasLintPass(cand: CandidateFile): boolean;
/**
 * Accept a staged candidate into the chapter draft. Explicit tool only —
 * never called implicitly by generation. Replaces or appends body per mode.
 *
 * Refuse rules (engineering gate — not AI judgment):
 * - already-accepted candidate → refuse (stage a new one)
 * - no successful style_lint since stage (missing lintPassToken) → refuse
 * - lintPassToken provided but mismatches → refuse
 * - target chapter status is final → refuse unless force=true
 */
export declare function acceptCandidate(dir: string, candidateId: string, mode?: "replace" | "append", opts?: {
    force?: boolean;
    lintPassToken?: string;
}): Promise<ChapterRecord>;
export declare function listCandidates(dir: string): Promise<Array<Omit<CandidateFile, "body"> & {
    wordCount: number;
    pending: boolean;
}>>;
export declare function readBriefCrumbs(dir: string): Promise<BriefCrumbFile>;
export declare function recordBriefBreadcrumb(dir: string, input: {
    chapterId: string;
    assetIds: string[];
}): Promise<BriefBreadcrumb>;
/** Most recent brief for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export declare function getRecentBrief(dir: string, chapterId: string, maxAgeMs?: number): Promise<BriefBreadcrumb | null>;
export declare function readPayoffAudits(dir: string): Promise<PayoffAuditFile>;
export declare function storePayoffAudit(dir: string, entry: Omit<PayoffAuditStored, "at"> & {
    at?: string;
}): Promise<PayoffAuditStored>;
export declare function getLastPayoffAudit(dir: string, chapterId?: string): Promise<PayoffAuditStored | null>;
/** Most recent payoff audit for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export declare function getRecentPayoffAudit(dir: string, chapterId: string, maxAgeMs?: number): Promise<PayoffAuditStored | null>;
export interface PanelSnapshot {
    schemaVersion: number;
    generatedAt: string;
    workKey: string;
    title: string;
    genre: string;
    dir: string;
    storageBase?: string;
    totals: {
        chapters: number;
        words: number;
        final: number;
        drafted: number;
        planned: number;
    };
    foundation: {
        locks: string;
        happened: string;
        threads: string;
        style: string;
    };
    chapters: Array<{
        id: string;
        title: string;
        position: number;
        status: ChapterStatus;
        wordCount: number;
        situationLens: string;
        livedScene: string;
        stateLens: string;
        briefRecent: boolean;
    }>;
    ledgerRecent: Array<{
        id: string;
        at: string;
        kind: string;
        chapterId: string;
        summary: string;
        styleHitCount?: number;
    }>;
    candidates: Array<{
        id: string;
        chapterId: string;
        stagedAt: string;
        pending: boolean;
        wordCount: number;
        note: string;
        editOf?: string;
        editMode?: string;
        draftLabel?: string;
        variantGroup?: string;
        unifyOf?: string[];
        hasLintPass: boolean;
        lintHitCount: number;
        source?: string;
    }>;
    /** Optional multi-draft feature flag (default false). */
    multiDraftEnabled: boolean;
    briefCrumbsRecent: BriefBreadcrumb[];
    lastPayoffByChapter: Record<string, PayoffAuditStored>;
    nextHints: string[];
    product: PanelProductView;
    library: PanelLibraryView;
    inspiration: PanelInspirationView;
    html: string;
}
export declare function buildPanelSnapshot(dir: string, pathsHint?: StoragePaths, opts?: {
    includeHtml?: boolean;
}): Promise<PanelSnapshot>;
export declare function assembleManuscript(dir: string, paths: StoragePaths, opts?: {
    onlyFinal?: boolean;
    outputRel?: string;
}): Promise<{
    file: string;
    words: number;
    chapters: number;
}>;
export declare function removeWorkDir(dir: string): Promise<void>;
