/** 拆书分析 — 对外聚合（analysis.js 只做 facade）。 */
import { PLUGIN_VERSION } from "../../version.js";
import { REPORT_SECTION_COUNT } from "../../domain/report-sections.js";
import { DIMENSIONS, HOOK_TYPES, LAYERS } from "../../domain/card-schema.js";

export {
    assertSourceId,
    analysisPaths,
    nowIso,
    readJson,
    readJsonl,
    writeJsonl,
} from "./paths.js";
export {
    chapterIndex,
    totalChapters,
    chapterText,
    chapterTitle,
    nearestChapter,
} from "./chapters.js";
export {
    ensureAnalysis,
    writeAnalysisMeta,
    readAnalysisBundle,
    listAnalyses,
} from "./meta.js";
export {
    WHITE_DESC_HARD_RE,
    WHITE_DESC_SOFT_RE,
    validateChapterFacts,
    upsertChapter,
} from "./facts.js";
export {
    validatePlot,
    validateRhythm,
    validateCharacter,
    upsertPlot,
    writeRhythm,
    upsertCharacter,
} from "./structure.js";
export {
    CARD_V2_FIELDS,
    deriveAxis,
    validateModule,
    isV2Card,
    toCardView,
} from "./modules.js";
export {
    quoteOk,
    extractBodyQuotes,
    verifyBodyQuotes,
    verifyModuleEvidence,
} from "./evidence.js";
export {
    COVERAGE_WEIGHTS,
    STRUCTURE_WEIGHTS,
    AUTO_CONFIDENCE_CAP,
    REVIEW_THRESHOLD,
    COVERAGE_DIMENSION_MAX,
    textStats,
    computeCoverage,
} from "./coverage.js";
export { buildReport } from "./report.js";
export { readSurvey, writeSurvey, ensureSurvey } from "./survey.js";
export {
    PLAN_RATIO_DEFAULT,
    PLAN_RATIO_MIN,
    PLAN_RATIO_MAX,
    PLAN_BATCH_DEFAULT,
    PLAN_BATCH_MIN,
    PLAN_BATCH_MAX,
    PLAN_SMALL_BOOK_CHARS,
    PLAN_CHARS_PER_TOKEN,
    PLAN_MINUTES_PER_BATCH,
    buildPlan,
    estimatePlan,
    planLabel,
    writePlan,
    readPlan,
    deletePlan,
    renderPlanMarkdown,
    makeConfirmToken,
    writePendingConfirm,
    readPendingConfirm,
    assertFullConsent,
    clearPendingConfirm,
    planProgress,
    planMembership,
} from "./plan.js";

export const AnalysisPort = {
    id: "port.analysis",
    version: PLUGIN_VERSION,
    summary: `拆书分析层：事实→聚合→抽象→报告（v2，${REPORT_SECTION_COUNT} 节）。`,
    LAYERS,
    DIMENSIONS,
    HOOK_TYPES,
};
