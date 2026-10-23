import type { Candidate, ExecContext, Foundation, Outline, PluginConfig, StoragePaths } from "./types.js";
/** 面板用的项目摘要。 */
interface ProjectSummary {
    id: string;
    base: string;
    name?: string;
    lastUsedAt?: string;
    exists?: boolean;
    works?: {
        key: string;
        title: string;
        genre?: string;
        chapters: number;
        wordCount: number;
        updatedAt?: string;
    }[];
    worksCount?: number;
    chapters?: number;
    words?: number;
}
export declare function withLock(key: string, fn: (...args: any[]) => any): Promise<any>;
export declare function countWords(text: string): number;
export declare function slugify(title: string): string;
export declare function assertResourceId(id: string, label?: string): string;
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
    id: any;
    base: string;
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
    }[];
    worksCount: number;
    chapters: any;
    words: any;
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
export declare function atomicWrite(file: string, content: string): Promise<void>;
export declare function workDir(paths: StoragePaths, key: string): string;
/** Recency window for brief / payoff soft·hard checks on accept (12h). */
export declare const BRIEF_RECENT_MS: number;
/** chapter_save: body over this word count needs confirm_bypass=true. */
export declare const SAVE_BYPASS_WORD_THRESHOLD = 200;
export declare function createWork(paths: StoragePaths, input: any): Promise<{
    meta: {
        schemaVersion: number;
        key: string;
        title: any;
        genre: any;
        premise: any;
        foundation: Foundation;
        createdAt: string;
        updatedAt: string;
        chapters: never[];
    };
    dir: string;
}>;
export declare function listWorks(paths: StoragePaths): Promise<any[]>;
export declare function readWorkMeta(dir: string): Promise<any>;
export declare function writeWorkMeta(dir: string, meta: any): Promise<void>;
export declare function resolveWorkDir(paths: StoragePaths, keyOrTitle: any): Promise<string>;
export declare function listChapters(dir: string): Promise<any[]>;
export declare function readChapter(dir: string, chapterId: string): Promise<{
    id: any;
    title: any;
    position: number;
    status: string;
    wordCount: number;
    updatedAt: string;
    body: string;
    outline: Outline;
} | {
    id: string;
    title: string;
    position: any;
    status: any;
    wordCount: number;
    updatedAt: string;
    body: string;
    outline: Outline;
}>;
export declare function saveChapter(dir: string, input: any): Promise<any>;
export declare function setOutline(dir: string, chapterId: string, patch: any): Promise<any>;
export declare function setFoundation(dir: string, patch: any): Promise<any>;
export declare function readLedger(dir: string): Promise<any>;
export declare function appendLedger(dir: string, entry: any): Promise<any>;
/** Persist candidate JSON without dropping optional multi-draft / edit fields. */
export declare function candidateToDiskMeta(cand: any): Candidate;
export declare function stageCandidate(dir: string, input: any): Promise<Candidate>;
export declare function readCandidate(dir: string, candidateId: string): Promise<any>;
/**
 * Record that style_lint ran on a staged candidate and issue lintPassToken.
 * Token proves the sensor ran (hitCount may be > 0) — NOT a quality pass.
 * Clears any prior token. Accept still requires the token; hitCount is echoed / optional strict.
 */
export declare function markCandidateLinted(dir: string, candidateId: string, hitCount: any): Promise<any>;
/** True when candidate has a lint pass recorded at/after stagedAt. */
export declare function candidateHasLintPass(cand: any): boolean;
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
export declare function acceptCandidate(dir: string, candidateId: string, mode?: any, opts?: any): Promise<any>;
export declare function listCandidates(dir: string): Promise<any[]>;
export declare function readBriefCrumbs(dir: string): Promise<any>;
export declare function recordBriefBreadcrumb(dir: string, input: any): Promise<any>;
/** Most recent brief for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export declare function getRecentBrief(dir: string, chapterId: string, maxAgeMs?: any): Promise<any>;
export declare function readPayoffAudits(dir: string): Promise<any>;
export declare function storePayoffAudit(dir: string, entry: any): Promise<any>;
export declare function getLastPayoffAudit(dir: string, chapterId: string): Promise<any>;
/** Most recent payoff audit for chapter within maxAgeMs (default BRIEF_RECENT_MS). */
export declare function getRecentPayoffAudit(dir: string, chapterId: string, maxAgeMs?: any): Promise<any>;
export declare function buildPanelSnapshot(dir: string, pathsHint: any, opts?: any): Promise<{
    schemaVersion: number;
    generatedAt: string;
    workKey: any;
    title: any;
    genre: any;
    dir: string;
    storageBase: any;
    totals: {
        chapters: number;
        words: number;
        final: number;
        drafted: number;
        planned: number;
    };
    foundation: {
        locks: any;
        happened: any;
        threads: any;
        style: any;
    };
    chapters: {
        id: any;
        title: any;
        position: any;
        status: any;
        wordCount: any;
        situationLens: string;
        livedScene: string;
        stateLens: string;
        briefRecent: boolean;
    }[];
    ledgerRecent: any;
    candidates: {
        id: any;
        chapterId: any;
        stagedAt: any;
        pending: any;
        wordCount: any;
        note: any;
        editOf: any;
        editMode: any;
        draftLabel: any;
        variantGroup: any;
        unifyOf: any;
        hasLintPass: boolean;
        lintHitCount: any;
        source: any;
    }[];
    multiDraftEnabled: boolean;
    briefCrumbsRecent: any;
    lastPayoffByChapter: Record<string, any>;
    nextHints: string[];
    product: {
        loopLine: string;
        writeLine: string;
        version: string;
        toolCount: number;
        pillars: {
            id: any;
            title: any;
            loopStage: any;
            summary: any;
            handsOffTo: any;
            status: any;
        }[];
    };
    library: {
        sourcesCount: any;
        sourceRoot: string;
        pendingCount: number;
        pending: {
            name: any;
            bytes: any;
        }[];
        sources: any;
        analyses: {
            sourceId: any;
            stage: any;
            facts: any;
            totalChapters: any;
            plots: any;
            plan: {
                mode: any;
                ratio: any;
                label: string;
                done: any;
                total: any;
            } | null;
        }[];
        craftCount: number;
        mindCount: number;
        acceptedCount: any;
        draftedCount: any;
        combo: {
            ok: boolean;
            cardIds: any[] | never[];
            mindTitle: any;
            craftTitles: any[];
            emptyReason: string | undefined;
        } | null;
        summary: string;
    } | {
        sourcesCount: number;
        sourceRoot: any;
        pendingCount: number;
        pending: never[];
        sources: never[];
        craftCount: number;
        mindCount: number;
        acceptedCount: number;
        draftedCount: number;
        combo: null;
        summary: string;
    };
    inspiration: {
        sessionsCount: number;
        sessions: {
            id: any;
            goal: any;
            genre: any;
            updatedAt: any;
            forgeAt: any;
            cardCount: any;
        }[];
        pendingEmits: number;
        acceptedEmits: number;
        appliedToWork: boolean;
        appliedCandIds: any[];
        foundationFilled: boolean;
        foundationFilledFields: string[];
        outlineProgress: {
            total: any;
            withSituation: number;
            withLived: number;
            withState: number;
            complete: number;
        };
        summary: string;
    };
    html: string;
}>;
export declare function assembleManuscript(dir: string, paths: StoragePaths, opts?: any): Promise<{
    file: string;
    words: number;
    chapters: number;
}>;
export declare function removeWorkDir(dir: string): Promise<void>;
export {};
