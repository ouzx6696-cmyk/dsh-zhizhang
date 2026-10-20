/**
 * AcceptPolicy — compose Brief → Lint → Payoff → HumanFeel → NovelSense
 * (quality surface: style token + payoff + feel/poison + book) before store acceptCandidate.
 * Tools must call this instead of inlining gate ifs.
 */
import type { BriefBreadcrumb, CandidateFile, PayoffAuditStored } from "../types.js";
import { type GateDecision } from "./types.js";
export interface AcceptPolicyInput {
    candidate: CandidateFile;
    brief: BriefBreadcrumb | null | undefined;
    payoff: PayoffAuditStored | null | undefined;
    skipBrief?: boolean;
    strictLint?: boolean;
    requirePayoff?: boolean;
    /** Soft human-feel radar; default from PortConfig (false). */
    strictHuman?: boolean;
    /** Soft novel-sense radar; default from PortConfig (false). */
    strictNovel?: boolean;
    /** Previous chapter body for isomorphic re-demo check (optional). */
    prevBody?: string | null;
    /** Craft humanFeel blob; enables stiffness_tidy when shatter cues present. */
    craftCue?: string | null;
    /** Path A: accept this edit result as formal chapter (requires confirm). */
    acceptAfterEdit?: boolean;
    /** Path A one-shot confirm — never silent. */
    confirmAcceptAfterEdit?: boolean;
}
export interface AcceptGateResult extends GateDecision {
    hitCount: number;
    /** Lines to append after successful accept (echo + soft warns / info). */
    receiptLines: string[];
}
export declare const AcceptPolicy: {
    evaluate(input: AcceptPolicyInput): AcceptGateResult;
};
/** First hard-error code for ZhizhangError. */
export declare function firstDenyCode(decision: GateDecision): string;
export declare function firstDenyText(decision: GateDecision): string;
