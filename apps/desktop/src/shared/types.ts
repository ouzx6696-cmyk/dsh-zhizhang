import { AppError } from "@zhizhang/core/errors";
import type { Focus, Target } from "../context.js";

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type TaskEndReason = "done" | "cancelled" | "failed";

export type TaskState = {
  id: string;
  name: string;
  completed: string[];
  current: string;
  waiting: string;
  tokens: number;
  cost: number;
  startedAt: number;
  endedAt?: number;
};

export type WriterMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  at: number;
  result?: unknown;
};

export type SourceEditState = {
  dirty: boolean;
  saving: boolean;
};

export type WorkspaceContext = {
  target: Target | null;
  focus: Focus;
  candidate?: { id: string; title?: string };
  actions?: {
    saveParagraph?: () => Promise<void>;
  };
};

export function asRecord(value: unknown, label = "对象"): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("input.invalid", `${label}格式无效`);
  }
  return value as Record<string, unknown>;
}

export function parseText(value: unknown, label = "文本"): string {
  if (typeof value !== "string") {
    throw new AppError("input.invalid", `${label}须为字符串`);
  }
  return value;
}

export function parseChoice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  label = "选项",
): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new AppError("input.invalid", `${label}无效：${String(value)}`);
  }
  return value as T[number];
}

export type ArticleRow = {
  id: string;
  root: string;
  title: string;
  status: string;
  rev: number;
  qa?: { score?: number; pass?: boolean };
  updated?: string;
};

export type ArticleDetail = ArticleRow & {
  draft?: { sha256?: string; text?: string };
  card?: Record<string, unknown>;
};

export type WriterResult = {
  kind: "candidate" | "review" | "qa" | "delivery";
  target: Target;
  focus: Focus;
  label: string;
  draftLabel?: string;
  summary: string;
  failed?: boolean;
};

export function writerResult(value: unknown): WriterResult | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r.kind !== "string" || typeof r.label !== "string" || typeof r.summary !== "string") return null;
  return r as unknown as WriterResult;
}

export type WorkspaceProps = {
  target: Target;
  view: string;
  agent: import("react").ReactNode;
  pipeline?: import("react").ReactNode;
  tab: string;
  setTab: (tab: string) => void;
  onView: (view: string) => void;
  onReview: () => void;
  onNewChapter: () => void;
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  split?: boolean;
  onToggleSplit?: () => void;
  focusMode?: boolean;
  readOnly?: boolean;
  onContext: (ctx: WorkspaceContext) => void;
  onTarget: (target: Target & { focus?: Focus }) => void;
  onSourceEditState: (state: SourceEditState) => void;
  onMethodEditState: (state: { dirty: boolean; saving: boolean }) => void;
};
