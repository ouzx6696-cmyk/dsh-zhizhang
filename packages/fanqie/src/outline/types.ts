/** 大纲与公共计划类型的最终契约（arch-freeze-v1 / F2 §1–§2）。 */

export type ProvenanceSource = "author" | "plan" | "import" | "ledger" | "assistant";

export interface Provenance {
  source: ProvenanceSource;
  /** imp-… / led-… / pln-… / asst-… */
  batch?: string;
  /** RunRecord.id */
  run?: string;
  /** 章位置（记账来源时） */
  chapter?: number;
  /** ISO 时间，来自注入时钟 */
  at: string;
}

export interface SourceRef {
  batch: string;
  /** S12 */
  section: string;
  /** ["P12.3","P12.4"]，1–20 条 */
  paras: string[];
  /** ≤80 字；模型给 ≤40，近似定位时存命中句 */
  quote: string;
  located: "exact" | "fuzzy" | false;
  /** source.txt 中的字符偏移（located 时有） */
  start?: number;
  end?: number;
}

/** 二选一：已有线 id 或待建线标题。 */
export interface ThreadRef {
  thread?: string;
  title?: string;
}

/** 大纲节点状态，独立于章节状态词（ADR-019）。 */
export type PlanStatus = "draft" | "settled";

export interface PlanNodeBase {
  /** vol- / act- / pl- + 8 位 Crockford base32 */
  id: string;
  /** 1–60 */
  title: string;
  /** ≤2000 */
  summary?: string;
  /** ≤500 */
  goal?: string;
  /** ≤500 */
  conflict?: string;
  /** ≤10 条，每条 ≤120 */
  payoffs?: string[];
  /** ≤300 */
  hook?: string;
  /** ≤20 */
  plant?: ThreadRef[];
  /** ≤20 */
  pay?: ThreadRef[];
  /** 实体 id，≤40 */
  cast?: string[];
  /** 500–2,000,000 */
  wordTarget?: number;
  planStatus: PlanStatus;
  /** ≤4000，不进 AI 上下文 */
  notes?: string;
  provenance: Provenance;
  /** ≤10 */
  src?: SourceRef[];
  /** ≥0 */
  rev: number;
}

export interface Beat {
  title: string;
  goal: string;
  conflict: string;
  hook?: string;
}

export interface ChapterPlan extends PlanNodeBase {
  /** 绑定正文 ch-…；与 front matter outlineId 一一对应 */
  chapterId?: string;
  /** 实体 id */
  pov?: string;
  /** 实体 id，kind=place */
  location?: string;
  /** ≤60 */
  timeAnchor?: string;
  /** ≤20 */
  beats?: Beat[];
  /** ≤10，每条 ≤120 */
  mustInclude?: string[];
  /** ≤10，每条 ≤120 */
  mustAvoid?: string[];
  /** ≤60 */
  emotion?: string;
}

/** ≤400 章纲 */
export interface Act extends PlanNodeBase {
  chapters: ChapterPlan[];
}

/** ≤60 幕 */
export interface VolumeFile extends PlanNodeBase {
  format: "zhizhang/1.3";
  acts: Act[];
}

export interface BookFile {
  format: "zhizhang/1.3";
  /** 1–100 */
  title: string;
  /** ≤300 */
  logline?: string;
  /** ≤1000 */
  coreConflict?: string;
  /** ≤10 */
  sellingPoints?: string[];
  wordTarget?: number;
  /** ≤60，与 outline/volumes/*.json 一一对应 */
  volumeOrder: string[];
  rev: number;
}

/** 视图（派生，不落盘）：fanqie.outline.get 的结果 */
export interface OutlineNodeView {
  id: string;
  level: "volume" | "act" | "chapter";
  parent?: string;
  title: string;
  planStatus: PlanStatus;
  /** 仅章纲，从 1 开始 */
  position?: number;
  chapterId?: string;
  chapterStatus?: string;
  wordCount?: number;
  wordTargetRollup?: number;
  progress?: { final: number; total: number };
  /** 一致性发现计数 */
  findings?: number;
  rev: number;
}

export interface OutlineView {
  book: BookFile;
  /** 先序遍历 */
  nodes: OutlineNodeView[];
  /** 未归位正文 */
  unplaced: { chapterId: string; title: string; status: string }[];
  /** index.json 中 outline 的聚合 rev */
  rev: number;
}

/** 大纲操作（全部可撤销，逆操作见 D-02 的 changeset）。 */
export type OutlineOp =
  | {
      type: "node.create";
      level: "volume" | "act" | "chapter";
      parent?: string;
      index: number;
      node: PlanNodeBase | ChapterPlan;
    }
  | {
      type: "node.update";
      id: string;
      patch: Partial<Omit<ChapterPlan, "id" | "rev" | "provenance">>;
      expectedRev: number;
    }
  | { type: "node.delete"; id: string; expectedRev: number }
  | { type: "node.move"; ids: string[]; parent?: string; index: number }
  /** 绑定的正文留在 parts[0] */
  | { type: "chapter.split"; id: string; parts: ChapterPlan[] }
  | { type: "chapter.merge"; ids: string[]; into: ChapterPlan }
  | { type: "act.split" | "volume.split"; id: string; at: number; newNode: PlanNodeBase }
  | { type: "act.merge" | "volume.merge"; ids: [string, string] }
  | { type: "chapter.bind"; plan: string; chapterId: string }
  | { type: "chapter.unbind"; plan: string }
  | {
      type: "book.update";
      patch: Partial<Omit<BookFile, "format" | "volumeOrder" | "rev">>;
      expectedRev: number;
    };

/** 位置重映射（ADR-003）。 */
export type PositionMap = { from: number; to: number }[];

export interface RemapPreview {
  moves: { id: string; title: string; from: number; to: number }[];
  affected: {
    file: "states" | "threads" | "knowledge" | "ledger" | "timeline";
    id: string;
    label: string;
    field:
      "since" | "until" | "opened" | "plannedPayoff" | "dueBy" | "beat" | "position" | "chapter";
    from: number;
    to: number;
  }[];
  invalid: { id: string; reason: "until_le_since" | "pay_before_plant" }[];
  /** 预览令牌：提交时回传，库 rev 变了即失效 */
  token: string;
}
