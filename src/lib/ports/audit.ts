/**
 * Audit adapters — style / payoff / human-feel / novel-sense soft radars behind stable ports.
 * Sensors stay pure; this file is the only place tools should import them from
 * when wiring (gates/tests may still import sensors for unit isolation).
 */
import { lintStyle, summarizeStyleLint, type StyleLintHit } from "../style-linter.js";
import {
  auditPayoff,
  formatPayoffAudit,
  type PayoffAuditResult,
} from "../payoff-audit.js";
import {
  auditHumanFeel,
  formatHumanFeelAudit,
  type HumanFeelAuditResult,
} from "./human-feel-gate.js";
import {
  auditNovelSense,
  formatNovelSenseAudit,
  type NovelSenseAuditResult,
} from "./novel-sense-gate.js";
import type { Outline } from "../types.js";

export const StyleLinterPort = {
  lint(text: string): StyleLintHit[] {
    return lintStyle(text);
  },
  summarize(hits: StyleLintHit[]) {
    return summarizeStyleLint(hits);
  },
  format(label: string, hits: StyleLintHit[], summary: ReturnType<typeof summarizeStyleLint>): string {
    const head = [
      `语感雷达 · ${label}`,
      `- cliche_syntax：${summary.cliche_syntax}`,
      `- lazy_emotion：${summary.lazy_emotion}`,
      `- process_skip：${summary.process_skip}`,
      `- slogan_ending：${summary.slogan_ending}`,
      `- 合计：${hits.length}`,
    ];
    if (hits.length === 0) return [...head, "", "未发现命中（对白区已豁免）。"].join("\n");
    const lines = hits
      .slice(0, 40)
      .map((h, i) => `${i + 1}. [${h.category}] 「${h.match}」 @${h.start}-${h.end} · ${h.hint}`);
    return [...head, "", ...lines, hits.length > 40 ? `…另有 ${hits.length - 40} 处` : ""]
      .filter(Boolean)
      .join("\n");
  },
};

export const PayoffAuditorPort = {
  audit(
    outline: Outline,
    body: string,
    opts?: { premise?: string; title?: string },
  ): PayoffAuditResult {
    return auditPayoff(outline, body, opts);
  },
  format(label: string, result: PayoffAuditResult): string {
    return formatPayoffAudit(label, result);
  },
};

export const HumanFeelAuditorPort = {
  /** Pass craftCue so stiffness_tidy matches Accept (shatter cues from craft cards). */
  audit(text: string, opts?: { craftCue?: string | null }): HumanFeelAuditResult {
    return auditHumanFeel(text, opts);
  },
  format(label: string, result: HumanFeelAuditResult): string {
    return formatHumanFeelAudit(label, result);
  },
};

export const NovelSenseAuditorPort = {
  audit(text: string, opts?: { prevBody?: string | null }): NovelSenseAuditResult {
    return auditNovelSense(text, opts);
  },
  format(label: string, result: NovelSenseAuditResult): string {
    return formatNovelSenseAudit(label, result);
  },
};

export type { StyleLintHit, PayoffAuditResult, HumanFeelAuditResult, NovelSenseAuditResult };
