import { type LockService } from "@zhizhang/core/lock";
import { type ChapterDocument } from "../domain/chapter.js";
export interface CandidateView {
    id: string;
    chapterId: string;
    title: string;
    wordCount: number;
    accepted: boolean;
    rejected: boolean;
}
export declare function listCandidates(workPath: string, chapterId?: string): Promise<CandidateView[]>;
export declare function readCandidate(workPath: string, chapterId: string, candidateId: string): Promise<{
    id: string;
    chapterId: string;
    title: string;
    body: string;
    wordCount: number;
}>;
export declare function acceptCandidate(workPath: string, input: {
    chapterId: string;
    candidateId: string;
    mode?: "replace" | "append";
}, lock?: LockService): Promise<ChapterDocument>;
export declare function rejectCandidate(workPath: string, input: {
    chapterId: string;
    candidateId: string;
    reason?: string;
}, lock?: LockService): Promise<{
    candidateId: string;
    rejectedAt: string;
}>;
//# sourceMappingURL=candidate.d.ts.map