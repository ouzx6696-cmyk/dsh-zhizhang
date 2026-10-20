import { type StoragePaths } from "./store.js";
import type { Foundation } from "./types.js";
export interface PanelLibraryView {
    sourcesCount: number;
    sourceRoot: string;
    pendingCount: number;
    pending: Array<{
        name: string;
        bytes: number;
    }>;
    sources: Array<{
        id: string;
        title: string;
        author: string;
    }>;
    craftCount: number;
    mindCount: number;
    acceptedCount: number;
    draftedCount: number;
    combo: {
        ok: boolean;
        cardIds: string[];
        mindTitle: string | null;
        craftTitles: string[];
        emptyReason?: string;
    } | null;
    summary: string;
}
export interface PanelInspirationView {
    sessionsCount: number;
    sessions: Array<{
        id: string;
        goal: string;
        genre: string;
        updatedAt: string;
        forgeAt?: string;
        cardCount: number;
    }>;
    pendingEmits: number;
    acceptedEmits: number;
    appliedToWork: boolean;
    appliedCandIds: string[];
    foundationFilled: boolean;
    foundationFilledFields: string[];
    outlineProgress: {
        total: number;
        withSituation: number;
        withLived: number;
        withState: number;
        complete: number;
    };
    summary: string;
}
export interface PanelProductView {
    loopLine: string;
    writeLine: string;
    version: string;
    pillars: Array<{
        id: string;
        title: string;
        loopStage: 1 | 2 | 3;
        summary: string;
        handsOffTo: string;
        status: string;
    }>;
}
export declare function buildLibraryView(paths: StoragePaths): Promise<PanelLibraryView>;
export declare function buildInspirationView(paths: StoragePaths, opts: {
    workKey: string;
    foundation: Foundation;
    chapters: Array<{
        situationLens: string;
        livedScene: string;
        stateLens: string;
    }>;
}): Promise<PanelInspirationView>;
export declare function buildProductView(): PanelProductView;
