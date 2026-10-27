/**
 * Lens-only chapter rows for /inspiration — skips ledger/candidates/briefs/payoffs
 * and the library+inspiration views a full buildPanelSnapshot would compute.
 */
export declare function listChapterLensRows(dir: string): Promise<{
    id: any;
    title: any;
    position: any;
    status: any;
    wordCount: any;
    situationLens: string;
    livedScene: string;
    stateLens: string;
}[]>;
export declare function buildPanelSnapshot(dir: string, pathsHint: any, opts?: any): Promise<{
    nextHints: any[];
    schemaVersion?: undefined;
    generatedAt?: undefined;
    workKey?: undefined;
    title?: undefined;
    genre?: undefined;
    dir?: undefined;
    storageBase?: undefined;
    totals?: undefined;
    foundation?: undefined;
    chapters?: undefined;
    ledgerRecent?: undefined;
    candidates?: undefined;
    revisionImpacts?: undefined;
    continuity?: undefined;
    multiDraftEnabled?: undefined;
    briefCrumbsRecent?: undefined;
    lastPayoffByChapter?: undefined;
    product?: undefined;
    library?: undefined;
    inspiration?: undefined;
    html?: undefined;
} | {
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
        locks: string;
        happened: string;
        threads: string;
        style: string;
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
        unavailable: any;
        error: any;
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
    revisionImpacts: any;
    continuity: {
        finalizedCount: any;
        workingCount: any;
        finalized: any;
        working: any;
    } | null;
    multiDraftEnabled: boolean;
    briefCrumbsRecent: any;
    lastPayoffByChapter: Record<string, any>;
    nextHints: any[];
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
            cardIds: any[];
            mindTitle: any;
            craftTitles: any[];
            emptyReason: string | undefined;
        };
        summary: string;
    } | {
        unavailable: boolean;
        recoveryPending: boolean;
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
        planning: {
            book: {
                content: any;
                truncated: boolean;
            } | null;
            volumes: any;
            totalVolumes: any;
            acts: any;
            totalActs: any;
        } | null;
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
    } | {
        unavailable: boolean;
        sessionsCount: number;
        sessions: never[];
        pendingEmits: number;
        acceptedEmits: number;
        appliedToWork: boolean;
        appliedCandIds: never[];
        foundationFilled: boolean;
        foundationFilledFields: never[];
        outlineProgress: {
            total: number;
            withSituation: number;
            withLived: number;
            withState: number;
            complete: number;
        };
        summary: string;
    };
    html: string;
}>;
