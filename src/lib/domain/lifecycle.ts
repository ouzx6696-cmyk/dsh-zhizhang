/** Separate content identity, contextual applicability, and declared review. */
import { createHash } from "node:crypto";

export const fingerprint = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
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
