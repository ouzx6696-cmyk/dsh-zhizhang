/** 导入契约（arch-freeze-v1 / F2 §5.2）。 */
import type {
  BibleIndex,
  EntityKind,
  Facet,
  KnowledgeRow,
  PendingItem,
  Thread,
} from "../bible/types.js";
import type { Beat } from "../outline/types.js";
import type { TextEncoding } from "@zhizhang/core/text";

export type SectionKind =
  | "outline-volume"
  | "outline-act"
  | "outline-chapter"
  | `setting-${EntityKind}`
  | "timeline"
  | "mixed"
  | "ignore"
  | "unknown";

/** imports/<batch>/docmap.json；docmap 阶段输出，作者可改。 */
export interface DocMap {
  /** 例 "第X卷" / "单元" / "第X章" */
  mapping: { volume?: string; act?: string; chapter?: string };
  sections: { id: string; kind: SectionKind; note?: string }[];
  /** 命名习惯，≤10 条，每条 ≤80 */
  naming: string[];
  editedByAuthor: boolean;
}

interface ItemBase {
  /** 临时 id，提交时由 IdSource 分配正式 id */
  tmp: string;
  /** 节号 1–20 条 */
  src: string[];
  /** ≤40 字逐字引文 */
  quote: string;
  confidence: number;
  ref?: string;
  maybe?: string[];
  why?: string;
}

export type ExtractItem =
  | (ItemBase & {
      type: "volume";
      title: string;
      order?: number;
      summary?: string;
      goal?: string;
      conflict?: string;
      payoffs?: string[];
      hook?: string;
      wordTarget?: number;
    })
  | (ItemBase & {
      type: "act";
      parent: string;
      title: string;
      order?: number;
      summary?: string;
      goal?: string;
      conflict?: string;
      payoffs?: string[];
      hook?: string;
      wordTarget?: number;
    })
  | (ItemBase & {
      type: "chapter";
      parent: string;
      title: string;
      order?: number;
      summary?: string;
      goal?: string;
      conflict?: string;
      payoffs?: string[];
      hook?: string;
      wordTarget?: number;
      cast?: string[];
      pov?: string;
      location?: string;
      plant?: string[];
      pay?: string[];
      beats?: Beat[];
      mustInclude?: string[];
      mustAvoid?: string[];
      timeAnchor?: string;
    })
  | (ItemBase & {
      type: "entity";
      kind: EntityKind;
      name: string;
      aliases?: string[];
      summary?: string;
      attributes?: Record<string, string>;
      locked?: string[];
      parent?: string;
      relations?: { to: string; label: string }[];
    })
  | (ItemBase & {
      type: "state";
      entity: string;
      facet: Facet;
      field?: string;
      target?: string;
      value: string;
      since?: number;
      until?: number;
    })
  | (ItemBase & {
      type: "thread";
      title: string;
      kind: Thread["kind"];
      plantAt?: number;
      payAt?: number;
      importance?: "major" | "minor";
      note?: string;
    })
  | (ItemBase & {
      type: "timeline";
      title: string;
      when: string;
      order?: number;
      chapter?: number;
      entities?: string[];
      summary?: string;
      canon?: "backstory" | "onstage";
    })
  | (ItemBase & {
      type: "knowledge";
      holder: string;
      fact: string;
      level: KnowledgeRow["level"];
      since?: number;
    })
  | (ItemBase & { type: "note"; text: string });

export interface ExtractResult {
  /** ≤80 条 */
  items: ExtractItem[];
  unassigned: { src: string[]; reason: string }[];
}

export interface ImportSourceMeta {
  name: string;
  bytes: number;
  sha256: string;
  encoding: TextEncoding;
  encodingConfidence: number;
  importedAt: string;
}

export interface ImportEstimate {
  chunks: number;
  tokens: { inputMin: number; inputMax: number; outputMin: number; outputMax: number };
  /** 仅展示，不参与卡口（ADR-010） */
  moneyRef: { min: number; max: number; currency: string } | null;
  model: string;
  /** 本次运行实际兜底值 */
  runBudget: number;
}

export interface ImportBatchView {
  batch: string;
  status: "staged" | "running" | "reviewing" | "partial" | "closed" | "reverted";
  source: ImportSourceMeta;
  segments: {
    id: string;
    title: string;
    level: number;
    kind: SectionKind;
    paras: number;
    selected: boolean;
  }[];
  estimate?: ImportEstimate;
  runId?: string;
  failedChunks: number[];
  counts?: Record<PendingItem["change"], number>;
}

export interface ImportProposal {
  format: "zhizhang/1.3";
  batch: string;
  run: string;
  libRevs: BibleIndex["files"];
  items: PendingItem[];
  unassigned: { src: string[]; reason: string }[];
  failedChunks: number[];
  stats: {
    total: number;
    byChange: Record<string, number>;
    byBand: Record<string, number>;
    located: number;
    fuzzy: number;
    unlocated: number;
  };
}

/** AppError.data.reason（F5）。 */
export type ImportFailReason =
  | "encoding_unsupported"
  | "file_type"
  | "file_too_large"
  | "too_long_select_sections"
  | "token_expired"
  | "batch_closed"
  | "proposal_stale"
  | "preview_stale";
