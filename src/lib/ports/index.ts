/**
 * Improvement ports — stable extension surface for dsh-zhizhang 0.9+.
 * One creative loop + Scheduler (default vs bypass). New policy → edit a port; tools stay thin.
 */
export { getPortConfig, setPortConfig, resetPortConfig, type PortConfig } from "./config.js";
export {
  BRIEF_RECENT_MS,
  SAVE_BYPASS_WORD_THRESHOLD,
} from "./config.js";
export {
  type GateDecision,
  type GateMessage,
  type GateSeverity,
  deny,
  allow,
  warn,
  info,
  mergeDecisions,
  formatGateMessages,
} from "./types.js";
export { LintGate } from "./lint-gate.js";
export { BriefGate } from "./brief-gate.js";
export { PayoffGate } from "./payoff-gate.js";
export { SaveBypassGate } from "./save-bypass-gate.js";
export {
  AcceptPolicy,
  firstDenyCode,
  firstDenyText,
  type AcceptPolicyInput,
  type AcceptGateResult,
} from "./accept-policy.js";
export {
  MethodRegistry,
  METHOD_ASSET_IDS,
  CHAPTER_BRIEF_ASSET_IDS,
  CHAPTER_BRIEF_FULL_ASSET_IDS,
  type MethodAsset,
} from "./methods.js";
export {
  StyleLinterPort,
  PayoffAuditorPort,
  HumanFeelAuditorPort,
  NovelSenseAuditorPort,
} from "./audit.js";
export {
  HumanFeelGate,
  auditHumanFeel,
  formatHumanFeelAudit,
  type HumanFeelHit,
  type HumanFeelHitCode,
  type HumanFeelAuditResult,
} from "./human-feel-gate.js";
export {
  NovelSenseGate,
  auditNovelSense,
  formatNovelSenseAudit,
  type NovelSenseHit,
  type NovelSenseHitCode,
  type NovelSenseAuditResult,
} from "./novel-sense-gate.js";
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
  neutralizeVoiceNegations,
  collectAdmitHits,
  warnCharacterStateWall,
  normalizeHandoff,
  formatHandoffBlock,
  normalizeKind,
  formatTechniqueCardBlock,
  formatTechniqueCardBlockLean,
  type LibraryCapability,
  type PillarStatus,
  type CardAxis,
  type CardRow,
  type CardQueryOpts,
  type ComboSuggestInput,
  type ComboSuggestResult,
  type ComboCardRef,
  type HumanFeelSpec,
  type BookCraftSpec,
  type MindSpec,
  type AnalysisHandoff,
  type TechniqueCardKind,
  type TechniqueCard,
  type MechanismSpec,
} from "./library.js";
export { InspirationPort, type InspirationCapability } from "./inspiration.js";
export {
  FoundationPort,
  extractBodyOutcome,
  endingBodyOverlap,
  resolveHappenedText,
  type AppendHappenedInput,
  type AppendHappenedResult,
  type HappenedSource,
  type ResolveHappenedTextResult,
} from "./foundation.js";
export { ProductMap, CREATIVE_LOOP_LINE, type ProductPillarView, type PillarLiveStatus } from "./product.js";
export {
  Scheduler,
  SCHEDULER_DEFAULT_LINE,
  SCHEDULER_WRITE_LINE,
  SCHEDULER_LIBRARY_LINE,
  SCHEDULER_INSPIRE_LINE,
  SCHEDULER_BYPASSES,
  type BypassRoute,
  type RouteKind,
} from "./scheduler.js";
export {
  QualityPolicy,
  QUALITY_AXES,
  QUALITY_POISON_POLICY,
  QUALITY_POISON_HINT,
  QUALITY_BOOK_DEBT_CUE_RE,
  QUALITY_WOBBLE_RE,
  type QualityAxis,
  type QualityAxisId,
} from "./quality-policy.js";
