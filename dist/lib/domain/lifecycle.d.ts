export declare const fingerprint: (value: unknown) => string;
export interface ChapterDependency {
    chapterId: string;
    revision: string;
    kind: "final" | "working";
}
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
export declare function contextBasis(meta: any, chapter: {
    revision: string;
}, previous?: ChapterDependency): ContextBasis;
