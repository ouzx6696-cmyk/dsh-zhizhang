import type { Outline } from "../types.js";
export declare function chaptersDir(dir: string): string;
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
export declare function readChapterLens(dir: string, chapterId: string): Promise<any>;
export declare function saveChapter(dir: string, input: any): Promise<{
    id: any;
    title: any;
    position: any;
    status: any;
    wordCount: number;
    updatedAt: string;
    body: any;
    outline: Outline;
}>;
/** Caller must hold the work lock. */
export declare function prepareChapterSaveUnlocked(dir: string, input: any): Promise<{
    record: {
        id: any;
        title: any;
        position: any;
        status: any;
        wordCount: number;
        updatedAt: string;
        body: any;
        outline: Outline;
    };
    chapterPath: string;
    chapterContent: string;
    metaContent: string;
}>;
/** Caller holds the work lock. */
export declare function saveChapterUnlocked(dir: string, input: any): Promise<{
    id: any;
    title: any;
    position: any;
    status: any;
    wordCount: number;
    updatedAt: string;
    body: any;
    outline: Outline;
}>;
export declare function setOutline(dir: string, chapterId: string, patch: any, title?: string, options?: {
    pace?: string;
}): Promise<{
    id: any;
    title: any;
    position: any;
    status: any;
    wordCount: number;
    updatedAt: string;
    body: any;
    outline: Outline;
}>;
/** Apply a direct chapter edit using the current content inside the work lock. */
export declare function updateChapter(dir: string, input: {
    id: string;
    title?: string;
    body?: string;
    status?: string;
    position?: number;
}): Promise<{
    id: any;
    title: any;
    position: any;
    status: any;
    wordCount: number;
    updatedAt: string;
    body: any;
    outline: Outline;
}>;
