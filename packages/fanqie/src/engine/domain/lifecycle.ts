import { sha256 } from "../../../../core/src/fsx.js";
/** Separate content identity, contextual applicability, and declared review. */


export const fingerprint = (value: unknown) => sha256(JSON.stringify(value ?? null));
export interface ChapterDependency { chapterId: string; revision: string; kind: "final" | "working" }
export interface ContextBasis {
    targetRevision: string;
    foundation: string;
    planning: string;
    previous?: ChapterDependency;
}
export interface ChapterReview {
    revision: string;
    basis: ContextBasis;
    result: "pass" | "blocked";
    summary: string;
    declaredBy: string;
    at: string;
}
export function contextBasis(meta: any, chapter: { revision: string }, previous?: ChapterDependency): ContextBasis {
    return { targetRevision: chapter.revision, foundation: fingerprint(meta.foundation), planning: fingerprint(meta.planning), ...(previous ? { previous } : {}) };
}
