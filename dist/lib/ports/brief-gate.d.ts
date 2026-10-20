/**
 * BriefGate — accept requires recent chapter_brief unless skip_brief.
 */
import type { BriefBreadcrumb } from "../types.js";
import { type GateDecision } from "./types.js";
export declare const BriefGate: {
    evaluateAccept(opts: {
        brief: BriefBreadcrumb | null | undefined;
        skipBrief: boolean;
        recentMs?: number;
    }): GateDecision;
};
