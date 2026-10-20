/**
 * LintGate — token = sensor ran; hitCount echoed; hits soft-warn by default.
 */
import type { CandidateFile } from "../types.js";
import { type GateDecision } from "./types.js";
export declare const LintGate: {
    issueToken(dir: string, candidateId: string, hitCount: number): Promise<{
        token: string;
        lintedAt: string;
        hitCount: number;
        chapterId: string;
    }>;
    hitCountOf(cand: CandidateFile): number;
    evaluateAccept(opts: {
        hitCount: number;
        strictLint: boolean;
    }): GateDecision;
    /** Always include on accept receipt. */
    echoLines(hitCount: number): string[];
};
