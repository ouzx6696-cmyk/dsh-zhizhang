import type { ChapterStatus } from "./status.js";
export interface ChapterFrontMatter {
    id: string;
    title: string;
    status: ChapterStatus;
    revision: string;
    outline?: Record<string, string>;
    scenes?: string[];
    review?: {
        round: number;
        verdict: "pass" | "revise" | "reject";
        quotes: string[];
        at: string;
    };
    editorPass?: boolean;
    editorRejections?: number;
    finalizedAt?: string;
}
export interface ChapterDocument {
    meta: ChapterFrontMatter;
    body: string;
}
export declare function parseChapterMarkdown(raw: string): ChapterDocument;
export declare function serializeChapterMarkdown(doc: ChapterDocument): string;
//# sourceMappingURL=chapter.d.ts.map