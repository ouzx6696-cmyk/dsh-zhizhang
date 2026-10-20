/**
 * 覆盖率 / 置信度 — 全插件唯一公式。
 *
 * 三层：覆盖（读了计划内多少章）· 证据（引文通过率）· 结构（测绘/剧情/节奏/人物）。
 * Auto 抽样封顶，避免「读 10% 却给全书 0.95」的假自信。
 */
import { DIMENSIONS } from "./card-schema.js";

export const COVERAGE_WEIGHTS = {
    ratio: 0.4,
    quote: 0.3,
    structure: 0.2,
    dimensions: 0.1,
};
export const STRUCTURE_WEIGHTS = {
    survey: 0.4,
    plots: 0.2,
    rhythms: 0.2,
    characters: 0.2,
};
export const AUTO_CONFIDENCE_CAP = 0.84;
export const REVIEW_THRESHOLD = 0.85;
export const COVERAGE_DIMENSION_MAX = DIMENSIONS.length;

export function textStats(text) {
    const raw = String(text ?? "");
    const chars = raw.replace(/\s/g, "").length;
    const sentences = raw.match(/[^。！？!?…]+[。！？!?…]+/g) ?? [];
    const avgSentence = sentences.length
        ? Math.round(sentences.reduce((s, x) => s + x.length, 0) / sentences.length)
        : 0;
    const dialogue = (raw.match(/“[^”]*”|「[^」]*」/g) ?? []).join("").length;
    return {
        chars,
        sentences: sentences.length,
        avgSentence,
        dialogueRatio: chars ? Number((dialogue / chars).toFixed(2)) : 0,
    };
}

export function computeCoverage(meta, facts, modules, quoteStats, extra = {}) {
    const scope = Number(meta?.scope?.chapters ?? 0) || Number(meta?.totalChapters ?? 0);
    const ratio = scope > 0 ? Math.min(1, facts.length / scope) : 0;
    const quotePass = quoteStats && quoteStats.total > 0 ? quoteStats.ok / quoteStats.total : 0;
    const dims = new Set(modules.map((m) => m.dimension).filter(Boolean)).size;
    const has = (x) => (Array.isArray(x) ? x.length > 0 : Boolean(x));
    const structure = STRUCTURE_WEIGHTS.survey * (extra.survey ? 1 : 0)
        + STRUCTURE_WEIGHTS.plots * (has(extra.plots) ? 1 : 0)
        + STRUCTURE_WEIGHTS.rhythms * (has(extra.rhythms?.points) ? 1 : 0)
        + STRUCTURE_WEIGHTS.characters * (has(extra.characters) ? 1 : 0);
    let confidence = COVERAGE_WEIGHTS.ratio * ratio
        + COVERAGE_WEIGHTS.quote * quotePass
        + COVERAGE_WEIGHTS.structure * structure
        + COVERAGE_WEIGHTS.dimensions * Math.min(1, dims / COVERAGE_DIMENSION_MAX);
    const capped = Boolean(extra.autoCap);
    if (capped)
        confidence = Math.min(confidence, AUTO_CONFIDENCE_CAP);
    return {
        facts: facts.length,
        scope,
        ratio,
        quotePass,
        dimensions: dims,
        structure: Number(structure.toFixed(3)),
        confidence: Number(confidence.toFixed(3)),
        capped,
        needsReview: confidence < REVIEW_THRESHOLD,
    };
}
