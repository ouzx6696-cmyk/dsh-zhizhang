export interface ClaimCandidate {
    id: string;
    text: string;
    kind: "number" | "date" | "quote" | "entity";
    paragraphHash: string;
    sourceId?: string;
    evidence?: string;
    status: "supported" | "unsupported" | "unlocated";
}
export declare function extractClaimCandidates(draftText: string): ClaimCandidate[];
//# sourceMappingURL=claims.d.ts.map