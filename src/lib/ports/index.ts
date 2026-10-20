// @ts-nocheck
/**
 * Improvement ports — stable extension surface for dsh-zhizhang 0.11+ (0.14 multi-draft).
 * One creative loop + Scheduler (default vs bypass) + optional EditPort. New policy → edit a port; tools stay thin.
 */
export { getPortConfig, setPortConfig, resetPortConfig } from "./config.js";
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD, } from "./config.js";
export { deny, allow, warn, info, mergeDecisions, formatGateMessages, } from "./types.js";
export { LintGate } from "./lint-gate.js";
export { BriefGate } from "./brief-gate.js";
export { PayoffGate } from "./payoff-gate.js";
export { SaveBypassGate } from "./save-bypass-gate.js";
export { AcceptPolicy, firstDenyCode, firstDenyText, } from "./accept-policy.js";
export { EditPort, EDIT_MODE_IDS, } from "./edit.js";
export { MethodRegistry, METHOD_ASSET_IDS, CHAPTER_BRIEF_ASSET_IDS, CHAPTER_BRIEF_FULL_ASSET_IDS, } from "./methods.js";
export { StyleLinterPort, PayoffAuditorPort, HumanFeelAuditorPort, NovelSenseAuditorPort, } from "./audit.js";
export { HumanFeelGate, auditHumanFeel, formatHumanFeelAudit, } from "./human-feel-gate.js";
export { NovelSenseGate, auditNovelSense, formatNovelSenseAudit, } from "./novel-sense-gate.js";
export { LibraryPort, normalizeHumanFeel, coerceHumanFeel, formatHumanFeelBlock, normalizeBookCraft, formatBookCraftBlock, normalizeMind, formatMindBlock, normalizeAxis, coerceAxis, admitCardContent, neutralizeVoiceNegations, collectAdmitHits, warnCharacterStateWall, normalizeHandoff, formatHandoffBlock, normalizeKind, formatTechniqueCardBlock, formatTechniqueCardBlockLean, formatModuleBlockV2, hasShatterCraftCue, craftCueFromHumanFeel, ANTI_STIFFNESS_BRIEF_LINE, DEFAULT_FAIL_AS_TEMPLATE, SHATTER_CRAFT_CUE_RE, PERMISSION_EDGE_RE, } from "./library.js";
export { InspirationPort } from "./inspiration.js";
export { FoundationPort, extractBodyOutcome, endingBodyOverlap, resolveHappenedText, } from "./foundation.js";
export { ProductMap, CREATIVE_LOOP_LINE } from "./product.js";
export { MultiDraftPort, isMultiDraftEnabled, envMultiDraftFlag, MULTI_DRAFT_DISABLED_CODE, } from "./multi-draft.js";
export { Scheduler, SCHEDULER_DEFAULT_LINE, SCHEDULER_WRITE_LINE, SCHEDULER_LIBRARY_LINE, SCHEDULER_INSPIRE_LINE, SCHEDULER_BYPASSES, } from "./scheduler.js";
export { QualityPolicy, QUALITY_AXES, QUALITY_POISON_POLICY, QUALITY_POISON_HINT, QUALITY_BOOK_DEBT_CUE_RE, QUALITY_WOBBLE_RE, } from "./quality-policy.js";
