/**
 * HumanFeelGate — soft sensor for 人味(写法+状态面) + poison axes of QualityPolicy
 * Not a "must sound like character X" gate.
 * （范文腔 / 过齐 / 任务句连排 / 设定清单·账本流水·家长里短）.
 * Heuristics are humble (not a quality law). Default soft warn; strictHuman → deny.
 */
import { type GateDecision } from "./types.js";
export type HumanFeelHitCode = "uniform_short_run" | "task_dialogue_wall" | "object_list_cold" | "setting_enum_dump" | "ledger_dump" | "domestic_trivia" | "stiffness_tidy";
export interface HumanFeelHit {
    code: HumanFeelHitCode;
    text: string;
    evidence: string;
}
export interface HumanFeelAuditResult {
    hitCount: number;
    hits: HumanFeelHit[];
    summary: string;
}
export declare function auditHumanFeel(text: string, opts?: {
    craftCue?: string | null;
}): HumanFeelAuditResult;
export declare function formatHumanFeelAudit(label: string, result: HumanFeelAuditResult): string;
export declare const HumanFeelGate: {
    audit: typeof auditHumanFeel;
    evaluateAccept(opts: {
        body: string;
        strictHuman: boolean;
        /** When craft cards promise shatter logics; enables stiffness_tidy. */
        craftCue?: string | null;
    }): GateDecision;
};
