import { type LockService } from "@zhizhang/core/lock";
import { type ChapterDocument } from "../domain/chapter.js";
import { type ChapterStatus } from "../domain/status.js";
import type { ChapterRowView } from "../view/snapshot.js";
export declare function listChapters(workPath: string): Promise<ChapterRowView[]>;
export declare function readChapter(workPath: string, chapterId: string): Promise<ChapterDocument>;
export declare function saveChapter(workPath: string, input: {
    chapterId: string;
    title?: string;
    body: string;
    expectedRevision?: string;
    status?: ChapterStatus;
    outline?: Record<string, string>;
}, lock?: LockService): Promise<ChapterDocument>;
export declare function reviewChapter(workPath: string, input: {
    chapterId: string;
    verdict: "pass" | "revise" | "reject";
    quotes?: string[];
    expectedRevision?: string;
}, lock?: LockService): Promise<ChapterDocument>;
export declare function finalizeChapter(workPath: string, input: {
    chapterId: string;
    expectedRevision?: string;
}, lock?: LockService): Promise<ChapterDocument>;
//# sourceMappingURL=chapter.d.ts.map