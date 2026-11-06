/**
 * 引擎端口：门禁、审计、方法资产、拆书库、灵感、调度、多草稿等可替换的策略面。
 * One creative loop + Scheduler (default vs bypass) + optional EditPort. New policy → edit a port; tools stay thin.
 */
export { getPortConfig } from "./config.js";
export { BRIEF_RECENT_MS, SAVE_BYPASS_WORD_THRESHOLD } from "./config.js";
export { deny, allow, warn, info, mergeDecisions, formatGateMessages } from "./types.js";
export { LintGate } from "./lint-gate.js";
export { BriefGate } from "./brief-gate.js";
export { PayoffGate } from "./payoff-gate.js";
export { SaveBypassGate } from "./save-bypass-gate.js";
export { AcceptPolicy, firstDenyCode, firstDenyText } from "./accept-policy.js";
export { EditPort } from "./edit.js";
export {
  MethodRegistry,
  METHOD_ASSET_IDS,
  CHAPTER_BRIEF_ASSET_IDS,
  CHAPTER_BRIEF_FULL_ASSET_IDS,
} from "./methods.js";
export {
  StyleLinterPort,
  PayoffAuditorPort,
  HumanFeelAuditorPort,
  NovelSenseAuditorPort,
} from "./audit.js";
export { HumanFeelGate, auditHumanFeel, formatHumanFeelAudit } from "./human-feel-gate.js";
export { NovelSenseGate, auditNovelSense, formatNovelSenseAudit } from "./novel-sense-gate.js";
export {
  LibraryPort,
  normalizeHumanFeel,
  coerceHumanFeel,
  formatHumanFeelBlock,
  normalizeBookCraft,
  formatBookCraftBlock,
  normalizeMind,
  formatMindBlock,
  normalizeAxis,
  coerceAxis,
  admitCardContent,
  warnCharacterStateWall,
  normalizeHandoff,
  formatHandoffBlock,
  normalizeKind,
  formatTechniqueCardBlock,
  formatTechniqueCardBlockLean,
  formatModuleBlockV2,
  styleCardFoundationEntry,
  hasShatterCraftCue,
  craftCueFromHumanFeel,
  ANTI_STIFFNESS_BRIEF_LINE,
} from "./library.js";
export { InspirationPort } from "./inspiration.js";
export { FoundationPort, endingBodyOverlap, resolveHappenedText } from "./foundation.js";
export { ProductMap } from "./product.js";
export { MultiDraftPort, isMultiDraftEnabled } from "./multi-draft.js";
export { isContinuityEnabled, requireContinuityEnabled } from "./continuity.js";
export { Scheduler } from "./scheduler.js";
export { QualityPolicy, QUALITY_BOOK_DEBT_CUE_RE, QUALITY_WOBBLE_RE } from "./quality-policy.js";
