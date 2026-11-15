import type { ContextPacket } from "@zhizhang/core/pipeline";
import type { Bible, BibleView, EntityHit } from "../bible/types.js";
export type PreviousTextMode = {
    kind: "full";
    maxChars: number;
} | {
    kind: "tail";
    chars: number;
};
export interface EarlyChapterDoc {
    chapter: string;
    position: number;
    summary: string;
    body?: string;
}
export interface RetrievedChapterHit {
    doc: EarlyChapterDoc;
    score: number;
    matchedTerms: number;
}
export interface BookPlanContext {
    title?: string;
    coreConflict?: string;
    currentVolume?: {
        volume: number;
        title: string;
        summary: string;
    };
}
export interface ReferenceCardContext {
    id: string;
    title: string;
    category: string;
    pattern: string;
    usage: string;
}
export interface ChapterContextInput {
    chapterId: string;
    position: number;
    outlineText: string;
    authorNote?: string;
    previousBody?: string;
    previousHandoff?: string;
    previousSummary?: string;
    bible: Bible;
    view: BibleView;
    hits: EntityHit[];
    recentSummaries: {
        position: number;
        summary: string;
    }[];
    earlyChapters?: EarlyChapterDoc[];
    l5TopK?: number;
    bookPlan?: BookPlanContext;
    referenceCards?: ReferenceCardContext[];
    budget: number;
    previousTextMode: PreviousTextMode;
}
export declare function tokenize2Grams(text: string): string[];
export declare function retrieveEarlyChapters(query: string, docs: EarlyChapterDoc[], topK?: number): RetrievedChapterHit[];
export declare function buildChapterContext(input: ChapterContextInput): ContextPacket;
//# sourceMappingURL=builder.d.ts.map