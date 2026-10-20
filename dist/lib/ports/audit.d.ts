/**
 * Audit adapters — style / payoff / human-feel / novel-sense soft radars behind stable ports.
 * Sensors stay pure; this file is the only place tools should import them from
 * when wiring (gates/tests may still import sensors for unit isolation).
 */
import { summarizeStyleLint, type StyleLintHit } from "../style-linter.js";
import { type PayoffAuditResult } from "../payoff-audit.js";
import { type HumanFeelAuditResult } from "./human-feel-gate.js";
import { type NovelSenseAuditResult } from "./novel-sense-gate.js";
import type { Outline } from "../types.js";
export declare const StyleLinterPort: {
    lint(text: string): StyleLintHit[];
    summarize(hits: StyleLintHit[]): Record<import("../style-linter.js").StyleLintCategory, number>;
    format(label: string, hits: StyleLintHit[], summary: ReturnType<typeof summarizeStyleLint>): string;
};
export declare const PayoffAuditorPort: {
    audit(outline: Outline, body: string, opts?: {
        premise?: string;
        title?: string;
    }): PayoffAuditResult;
    format(label: string, result: PayoffAuditResult): string;
};
export declare const HumanFeelAuditorPort: {
    /** Pass craftCue so stiffness_tidy matches Accept (shatter cues from craft cards). */
    audit(text: string, opts?: {
        craftCue?: string | null;
    }): HumanFeelAuditResult;
    format(label: string, result: HumanFeelAuditResult): string;
};
export declare const NovelSenseAuditorPort: {
    audit(text: string, opts?: {
        prevBody?: string | null;
    }): NovelSenseAuditResult;
    format(label: string, result: NovelSenseAuditResult): string;
};
export type { StyleLintHit, PayoffAuditResult, HumanFeelAuditResult, NovelSenseAuditResult };
