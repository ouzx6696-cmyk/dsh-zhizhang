// @ts-nocheck
/**
 * Audit adapters — style / payoff / human-feel / novel-sense soft radars behind stable ports.
 * Sensors stay pure; this file is the only place tools should import them from
 * when wiring (gates/tests may still import sensors for unit isolation).
 */
import { lintStyle, summarizeStyleLint } from "../style-linter.js";
import { auditPayoff, formatPayoffAudit, } from "../payoff-audit.js";
import { auditHumanFeel, formatHumanFeelAudit, } from "./human-feel-gate.js";
import { auditNovelSense, formatNovelSenseAudit, } from "./novel-sense-gate.js";
export const StyleLinterPort = {
    lint(text) {
        return lintStyle(text);
    },
    summarize(hits) {
        return summarizeStyleLint(hits);
    },
    format(label, hits, summary) {
        const head = [
            `语感雷达 · ${label}`,
            `- cliche_syntax：${summary.cliche_syntax}`,
            `- lazy_emotion：${summary.lazy_emotion}`,
            `- process_skip：${summary.process_skip}`,
            `- slogan_ending：${summary.slogan_ending}`,
            `- 合计：${hits.length}`,
        ];
        if (hits.length === 0)
            return [...head, "", "未发现命中（对白区已豁免）。"].join("\n");
        const lines = hits
            .slice(0, 40)
            .map((h, i) => `${i + 1}. [${h.category}] 「${h.match}」 @${h.start}-${h.end} · ${h.hint}`);
        return [...head, "", ...lines, hits.length > 40 ? `…另有 ${hits.length - 40} 处` : ""]
            .filter(Boolean)
            .join("\n");
    },
};
export const PayoffAuditorPort = {
    audit(outline, body, opts) {
        return auditPayoff(outline, body, opts);
    },
    format(label, result) {
        return formatPayoffAudit(label, result);
    },
};
export const HumanFeelAuditorPort = {
    /** Pass craftCue so stiffness_tidy matches Accept (shatter cues from craft cards). */
    audit(text, opts) {
        return auditHumanFeel(text, opts);
    },
    format(label, result) {
        return formatHumanFeelAudit(label, result);
    },
};
export const NovelSenseAuditorPort = {
    audit(text, opts) {
        return auditNovelSense(text, opts);
    },
    format(label, result) {
        return formatNovelSenseAudit(label, result);
    },
};
