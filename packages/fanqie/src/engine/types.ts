import type { PursuitOutline } from "./domain/pursuit.js";
/**
 * On-disk + in-memory types for Writer Agent. No Postgres.
 *
 * 这些是「落盘契约」的类型：meta.json / ledger.json / 候选文件都按这里的形状读写。
 * 外部 JSON 在边界解析，领域对象接入读写函数。
 */
import type { ToolExecution } from "../../../core/src/tool.js";

export const SCHEMA_VERSION = 1;
/** Five diagnostic evidence kinds for AI review *output* (agent-side; ledger stores them). */
export const REVIEW_EVIDENCE_KINDS = [
  "结构与锁定/伏笔咬合",
  "视角处境与注意力偏见",
  "亲历博弈充实度",
  "AI腔与心理偷懒诊断",
  "章末落点质感",
];
export interface Foundation {
  /** 作者锁定：不得违背的世界/人物设定 */
  locks: string;
  /** 已发生事实（按章累积） */
  happened: string;
  /** 人物卡摘要 */
  characters: string;
  /** 读者已知 */
  readerKnowledge: string;
  /** 计划中未发生 */
  planned: string;
  /** 未结伏笔 */
  threads: string;
  /** 全书文风约束 */
  style: string;
}

/**
 * T10 结构化连续性（continuity.enabled，默认关）：伏笔线、知识边界、章末交接与定稿核验。
 * 落盘在作品目录 continuity/ 下（foreshadow.json / knowledge.json / commits.json / handoff/<章id>.json）；
 * Foundation 的 happened/threads/readerKnowledge 为 legacy 保留，可用 fanqie_continuity_migrate 生成候选迁移。
 */
export const FORESHADOW_BEAT_KINDS = [
  "埋设",
  "强化",
  "误导",
  "部分揭示",
  "揭示",
  "兑现",
  "余波",
] as const;
export type ForeshadowBeatKind = (typeof FORESHADOW_BEAT_KINDS)[number];
export type ForeshadowStatus = "planned" | "written" | "committed" | "missed";
export const KNOWLEDGE_LEVELS = ["公开", "知情", "误认", "不知"] as const;
export type KnowledgeLevel = (typeof KNOWLEDGE_LEVELS)[number];

/** 线上的一笔：chapter 是章号（position）。evidence 是预期出现在正文里的短引句，commit 据此机械核验。 */
export interface ForeshadowBeat {
  chapter: number;
  kind: ForeshadowBeatKind;
  note: string;
  evidence?: string[];
}

export interface ForeshadowLine {
  id: string;
  title: string;
  /** 一句话伏笔 */
  seed: string;
  plannedPlant: number;
  plannedPayoff: number;
  /** 只由 commit 推进：核验到笔 → written；核到兑现/揭示或 plannedPayoff 处核验通过 → committed；payoff 章缺证 → missed */
  status: ForeshadowStatus;
  beats: ForeshadowBeat[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeHolder {
  /** 人物/势力名 */
  who: string;
  level: KnowledgeLevel;
  /** 该状态自第几章（position）起 */
  since: number;
  source?: string;
  /** 正文引句或章号；since 处的知情状态由 commit 据引句核验 */
  evidence?: string;
}

export interface KnowledgeItem {
  id: string;
  /** 一句话事实 */
  fact: string;
  holders: KnowledgeHolder[];
  createdAt: string;
  updatedAt: string;
}

export interface HandoffRecord {
  /** 章节 id */
  chapter: string;
  summary: string;
  mustCarry: string[];
  nextConstraints: string[];
  openLoops: string[];
  at: string;
  /** 文件级 revision，并发写冲突时如实报错 */
  revision: number;
}

export interface ContinuityCommitRecord {
  /** 章节 id */
  chapter: string;
  /** 核验绑定的正文 revision */
  revision: string;
  at: string;
  /** confirmed beat 引用，格式 `${lineId}:${chapter}` */
  beats: string[];
  /** confirmed knowledge id */
  knowledge: string[];
  notes?: string;
}

export interface ForeshadowFile {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  lines: ForeshadowLine[];
}
export interface KnowledgeFile {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  items: KnowledgeItem[];
}
export interface CommitsFile {
  schemaVersion: 1;
  revision: number;
  updatedAt: string;
  commits: ContinuityCommitRecord[];
}

export interface Outline extends PursuitOutline {
  pov: string;
  targetWords: number;
  locks: string;
  knowledge: string;
  synopsis: string;
  conflict: string;
  beats: string;
  ending: string;
  situationLens: string;
  livedScene: string;
  stateLens: string;
}

export type ChapterStatus = "planned" | "drafting" | "drafted" | "reviewed" | "final";

export interface ChapterMeta {
  id: string;
  title: string;
  position: number;
  status: ChapterStatus;
  wordCount: number;
  outline?: Outline;
  createdAt?: string;
  dependencies?: import("./domain/lifecycle.js").ChapterDependency[];
  updatedAt: string;
}

export interface Chapter extends Omit<ChapterMeta, "outline"> {
  body: string;
  outline: Outline;
  revision: string;
  review?: import("./domain/lifecycle.js").ChapterReview;
  dependencies: import("./domain/lifecycle.js").ChapterDependency[];
}

export interface WorkMeta {
  readingBenchmark?: import("./reading-radar.js").ReadingBenchmark;
  schemaVersion: number;
  key: string;
  title: string;
  genre: string;
  premise: string;
  /** Explicitly selected pacing; absent in legacy or undecided works. */
  pace?: "快爽" | "稳推" | "慢燃";
  foundation: Foundation;
  createdAt: string;
  updatedAt: string;
  chapters: ChapterMeta[];
  planning?: {
    schemaVersion: 1;
    book?: { content: string; [key: string]: unknown };
    volumes: Array<{ id: string; content: string; chapters: string[]; [key: string]: unknown }>;
    units?: import("./domain/pursuit.js").UnitPlan[];
    acts?: Array<{ id: string; content: string; chapters: string[]; [key: string]: unknown }>;
    [key: string]: unknown;
  };
  revisionImpacts?: Array<{
    chapterId: string;
    nextChapterId?: string;
    previousRevision?: string;
    revision: string;
    history: string;
    dependents: string[];
    reason: string;
    at: string;
  }>;
  continuity?: {
    schemaVersion: 1;
    finalized: Array<{ chapterId: string; revision: string; at: string }>;
    working: Array<{ chapterId: string; revision: string; at: string }>;
  };
}

export interface LedgerEntry {
  at: string;
  chapter?: string;
  kind: string;
  summary?: string;
  [key: string]: unknown;
}

export interface Ledger {
  schemaVersion: number;
  workKey: string;
  entries: LedgerEntry[];
}

export interface Candidate {
  schemaVersion: number;
  id: string;
  workKey: string;
  chapterId: string;
  stagedAt: string;
  source: string;
  note: string;
  body: string;
  bodyFile: string;
  wordCount: number;
  /** 语感雷达命中数（style_lint 写入） */
  targetRevision?: string;
  basis?: import("./domain/lifecycle.js").ContextBasis;
  lintHitCount?: number;
  /** 已扫过的凭据（只证明扫过，不等于过关） */
  lintPassToken?: string;
  /** Hash of the exact candidate text that was scanned. */
  lintBodyHash?: string;
  lintedAt?: string;
  /** 编辑稿指向源候选 */
  editOf?: string;
  /** 统一整理稿指向多个父候选 */
  unifyOf?: string[];
  draftLabel?: string;
  variantGroup?: string;
  editMode?: string;
  editedAt?: string;
  revisionSource?: {
    requestId: string;
    digest: string;
    pace: string | null;
    source?: import("./domain/diagnostics.js").DiagnosticSource;
  };
  acceptedAt?: string;
  acceptedMode?: string;
}

export interface StoragePaths {
  /** 存储根：manuscripts / inspiration / 默认 works、library */
  base: string;
  /** 作品目录：一本书一个同名文件夹 */
  works: string;
  manuscripts: string;
  /** 拆书库：index.json + sources/ + cards/ */
  library: string;
  inspiration: string;
  /** 本地书源目录（可空） */
  sourceRoot: string;
  /** 内部：解析来源标记（panel / agent 等） */
  resolvedVia?: string;
}

export interface PluginConfig {
  pursuit?: { enabled?: boolean; radar?: boolean };
  rootDir?: string;
  storageRoot?: string;
  worksRoot?: string;
  libraryRoot?: string;
  sourceRoot?: string;
  python?: string;
  requireEditorPass?: boolean;
  /** 内部：由 multiDraft.enabled 推出 */
  multiDraft?: { enabled?: boolean };
  /** 内部：结构化连续性开关（T10），parseFanqieConfig 解析后随配置传入 */
  continuity?: { enabled?: boolean };
  /** 内部：parseFanqieConfig 解析的写手工具面收窄开关 */
  toolset?: { narrowed?: boolean };
  /** 固定方法方案（默认 / 原版 / 用户方案名或 id）；parseFanqieConfig 解析后随配置传入 */
  profile?: string;
  [key: string]: unknown;
}

/** 工具执行上下文。 */
export interface ExecContext extends ToolExecution {
  failure?: { code: string; message: string };
  onWorkCreated?: (base: string, key: string) => void;
  onCandidateStaged?: (candidate: {
    id: string;
    chapterId: string;
    work: string;
    base: string;
  }) => void;
}

/**
 * openWork 只需要的字段：cwd 定位存储、sessionId 记住"会话上次作品"。
 * 供写作层（ToolExecution）等没有索引签名的上下文显式适配，替代 as never。
 */
export type OpenWorkContext = { cwd: string; sessionId?: string };

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
