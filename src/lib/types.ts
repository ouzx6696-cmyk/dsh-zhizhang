/** On-disk + in-memory types for dsh-zhizhang. No Postgres. */

export const SCHEMA_VERSION = 1;

export type ChapterStatus = "planned" | "drafting" | "drafted" | "reviewed" | "final";

export interface Foundation {
  locks: string;
  happened: string;
  characters: string;
  readerKnowledge: string;
  planned: string;
  threads: string;
  style: string;
}

/** Chapter craft outline — ported from 织章 Outline + situation fields. */
export interface Outline {
  pov: string;
  targetWords: number;
  locks: string;
  knowledge: string;
  synopsis: string;
  conflict: string;
  beats: string;
  ending: string;
  /** Observer situation / attention bias. */
  situationLens: string;
  /** Lived conflict vs overview beats. */
  livedScene: string;
  /** Chapter character-state / craft lens (not a character-voice primer). */
  stateLens: string;
}

export interface ChapterMeta {
  id: string;
  title: string;
  position: number;
  status: ChapterStatus;
  wordCount: number;
  updatedAt: string;
}

export interface ChapterRecord extends ChapterMeta {
  body: string;
  outline: Outline;
}

export interface WorkMeta {
  schemaVersion: number;
  key: string;
  title: string;
  genre: string;
  premise: string;
  foundation: Foundation;
  createdAt: string;
  updatedAt: string;
  chapters: ChapterMeta[];
}

/** Four-dimension author review (local ledger, not AI generation). */
export type ReviewDim =
  | "locks_ledger"
  | "pov_situation"
  | "style_radar"
  | "continuity_snap";

/** Five diagnostic evidence kinds for AI review *output* (agent-side; ledger stores them). */
export const REVIEW_EVIDENCE_KINDS = [
  "结构与锁定/伏笔咬合",
  "视角处境与注意力偏见",
  "亲历博弈充实度",
  "AI腔与心理偷懒诊断",
  "章末落点质感",
] as const;

export type ReviewEvidenceKind = (typeof REVIEW_EVIDENCE_KINDS)[number];

export interface LedgerIssue {
  category: string;
  finding: string;
  evidence: string;
  suggestion: string;
}

export type LedgerKind =
  | "style_lint"
  | "author_checks"
  | "ai_review_notes"
  | "finalize"
  | "note"
  | "chapter_save_direct"
  | "brief_seen"
  | "payoff_audit";

export interface LedgerEntry {
  id: string;
  at: string;
  chapterId: string;
  kind: LedgerKind;
  summary: string;
  dims?: Partial<Record<ReviewDim, boolean>>;
  issues?: LedgerIssue[];
  styleHitCount?: number;
}

/** Breadcrumb left by zhizhang_chapter_brief (soft gate for accept). */
export interface BriefBreadcrumb {
  chapterId: string;
  at: string;
  assetIds: string[];
}

export interface BriefCrumbFile {
  schemaVersion: number;
  workKey: string;
  entries: BriefBreadcrumb[];
}

/** Last payoff audit snapshot for panel (not a rewrite). */
export interface PayoffAuditStored {
  chapterId: string;
  at: string;
  source: "chapter" | "candidate" | "text";
  sourceId?: string;
  ok: boolean;
  warningCount: number;
  codes: string[];
  summary: string;
}

export interface PayoffAuditFile {
  schemaVersion: number;
  workKey: string;
  /** newest first or append-only; panel reads last per chapter */
  entries: PayoffAuditStored[];
}

export interface LedgerFile {
  schemaVersion: number;
  workKey: string;
  entries: LedgerEntry[];
}

/** Staged AI candidate — never auto-written to chapter body. */
export interface CandidateFile {
  schemaVersion: number;
  id: string;
  workKey: string;
  chapterId: string;
  stagedAt: string;
  source: "agent" | "import";
  note: string;
  body: string;
  /** Relative path of body snapshot under candidates/. */
  bodyFile: string;
  /** Set when candidate_accept succeeds; blocks double-accept. */
  acceptedAt?: string;
  acceptedMode?: "replace" | "append";
  /**
   * Issued by zhizhang_style_lint against this candidate (engineering gate).
   * accept refuses unless lintedAt >= stagedAt and token is present,
   * or caller passes the same lintPassToken.
   */
  lintPassToken?: string;
  lintedAt?: string;
  lintHitCount?: number;
}

export const EMPTY_FOUNDATION = (): Foundation => ({
  locks: "",
  happened: "",
  characters: "",
  readerKnowledge: "",
  planned: "",
  threads: "",
  style: "",
});

export const EMPTY_OUTLINE = (): Outline => ({
  pov: "",
  targetWords: 2500,
  locks: "",
  knowledge: "",
  synopsis: "",
  conflict: "",
  beats: "",
  ending: "",
  situationLens: "",
  livedScene: "",
  stateLens: "",
});

export const CHAPTER_STATUSES: ChapterStatus[] = [
  "planned",
  "drafting",
  "drafted",
  "reviewed",
  "final",
];
