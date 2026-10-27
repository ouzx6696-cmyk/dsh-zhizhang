import type { ContextBasis } from "../domain/lifecycle.js";
export declare function chaptersDir(dir: string): string;
export declare function listChapters(dir: string): Promise<any[]>;
export declare function readChapter(dir: string, chapterId: string): Promise<any>;
export declare function readChapterLens(dir: string, chapterId: string): Promise<any>;
export declare function assertContextBasis(dir: string, basis: ContextBasis, chapterId: string): Promise<void>;
export declare function currentContextBasis(dir: string, chapterId: string): Promise<ContextBasis>;
export declare function saveChapter(dir: string, input: any): Promise<any>;
/** Caller must hold the work lock. */
export declare function prepareChapterSaveUnlocked(dir: string, input: any): Promise<{
    record: any;
    history: string | undefined;
    chapterBefore: string | null;
    metaBefore: string | null;
    chapterPath: string;
    chapterContent: string;
    metaContent: string;
}>;
/** Caller holds the work lock. */
export declare function saveChapterUnlocked(dir: string, input: any): Promise<any>;
export declare function setOutline(dir: string, chapterId: string, patch: any, title?: string, options?: {
    pace?: string;
}): Promise<any>;
/** Apply a direct chapter edit using the current content inside the work lock. */
export declare function updateChapter(dir: string, input: {
    id: string;
    title?: string;
    body?: string;
    status?: string;
    position?: number;
    force?: boolean;
    expectedRevision?: string;
    ledgerEntry?: string;
    reviewSummary?: string;
    reviewResult?: "pass" | "blocked";
    reviewedBy?: string;
    acknowledgeRevision?: boolean;
}): Promise<any>;
