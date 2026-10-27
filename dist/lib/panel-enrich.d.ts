import type { StoragePaths } from "./types.js";
export declare function buildLibraryView(paths: StoragePaths): Promise<{
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
}>;
export declare function buildInspirationView(paths: StoragePaths, opts: any): Promise<{
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
}>;
export declare function buildProductView(): {
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
