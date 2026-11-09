import { isRecord } from "./parse.js";

/** Why a run stopped short of delivery, recorded on the run so the UI never parses its message. */
export const WORKFLOW_REASONS = [
  "run-budget",
  "stage-budget",
  "balance",
  "context",
  "interrupted",
  "stopped",
  "auth",
] as const;
export type WorkflowReason = (typeof WORKFLOW_REASONS)[number];
/** Reasons a stage can stop the run at a boundary with its progress kept for a later resume. */
export type PauseReason = Extract<
  WorkflowReason,
  "run-budget" | "stage-budget" | "balance" | "context"
>;
/**
 * A resumable stop at a stage boundary; the run keeps its completed stages. `usage` carries what
 * the provider already billed for the stage before it paused, so the journal still counts it.
 */
export class WorkflowPause extends Error {
  constructor(
    readonly reason: PauseReason,
    message: string,
    readonly usage?: WorkflowUsage,
  ) {
    super(message);
    this.name = "WorkflowPause";
  }
}

const WORKFLOW_GRADES = ["economy", "standard", "premium"] as const;
export type WorkflowGrade = (typeof WORKFLOW_GRADES)[number];
export type WorkflowKind = "book" | "chapter" | "article" | "ledger";
export interface EngineSettings {
  guided: boolean;
  grade: WorkflowGrade;
  inputBudget: number;
  runBudget: number;
}
/**
 * A standard-grade golden chapter (5 drafts, 3 readers x 2 positions x 4 challengers, review and
 * revise) needs roughly 0.4M input tokens; premium about 1M. The run budget is a stop-at-boundary
 * guard, so its default must let the chosen grade finish.
 */
export const DEFAULT_ENGINE: EngineSettings = {
  guided: true,
  grade: "standard",
  inputBudget: 24000,
  runBudget: 1200000,
};
/** 0.9.x / 1.0.0-preview.1 shipped 200000, which stops every standard golden chapter mid-run. */
const LEGACY_RUN_BUDGET = 200000;
export const BUDGET_LIMITS = { min: 2000, input: 1000000, run: 20000000 } as const;
export function parseEngine(value: unknown): EngineSettings {
  if (!isRecord(value)) throw new Error("写作引擎设置须为对象");
  if (
    Object.keys(value).some((key) => !["guided", "grade", "inputBudget", "runBudget"].includes(key))
  )
    throw new Error("写作引擎设置含未知字段");
  if (typeof value.guided !== "boolean" || !WORKFLOW_GRADES.includes(value.grade as WorkflowGrade))
    throw new Error("写作引擎模式或档位无效");
  for (const key of ["inputBudget", "runBudget"] as const) {
    const max = key === "inputBudget" ? BUDGET_LIMITS.input : BUDGET_LIMITS.run;
    if (
      typeof value[key] !== "number" ||
      !Number.isInteger(value[key]) ||
      value[key] < BUDGET_LIMITS.min ||
      value[key] > max
    )
      throw new Error(`上下文预算须为 ${BUDGET_LIMITS.min}–${max} 的整数`);
  }
  if (Number(value.runBudget) < Number(value.inputBudget))
    throw new Error("任务预算不能小于阶段预算");
  return {
    guided: value.guided,
    grade: value.grade as WorkflowGrade,
    inputBudget: Number(value.inputBudget),
    runBudget:
      Number(value.runBudget) === LEGACY_RUN_BUDGET
        ? DEFAULT_ENGINE.runBudget
        : Number(value.runBudget),
  };
}
export interface WorkflowRequest {
  kind: WorkflowKind;
  chapter: string;
  instruction: string;
  grade: WorkflowGrade;
  source: string;
  line: "news" | "story" | "micro";
}
export function parseWorkflowRequest(value: unknown): WorkflowRequest {
  if (!isRecord(value)) throw new Error("流水线请求须为对象");
  if (!["book", "chapter", "article", "ledger"].includes(String(value.kind)))
    throw new Error("流水线类型无效");
  for (const key of ["chapter", "instruction", "source"] as const)
    if (typeof value[key] !== "string") throw new Error(`流水线 ${key} 须为文本`);
  if (
    String(value.instruction).trim().length === 0 ||
    String(value.instruction).length > 12000 ||
    String(value.source).length > 48000
  )
    throw new Error("请填写任务要求，要求不超过 12000 字、来源不超过 48000 字");
  if (
    (value.kind === "chapter" || value.kind === "ledger") &&
    !/^[\p{L}\p{N}_-]{1,64}$/u.test(String(value.chapter))
  )
    throw new Error("章节标识无效");
  if (
    !WORKFLOW_GRADES.includes(value.grade as WorkflowGrade) ||
    !["news", "story", "micro"].includes(String(value.line))
  )
    throw new Error("流水线档位或文章线路无效");
  return {
    kind: value.kind as WorkflowKind,
    chapter: String(value.chapter),
    instruction: String(value.instruction).trim(),
    grade: value.grade as WorkflowGrade,
    source: String(value.source),
    line: value.line as WorkflowRequest["line"],
  };
}
export interface WorkflowUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
}
export interface WorkflowStep {
  id: string;
  title: string;
  status: "running" | "complete" | "failed";
  started: string;
  durationMs: number;
  attempts: number;
  usage: WorkflowUsage;
  output: unknown;
  error?: string;
  model?: string;
}
export interface WorkflowRecord {
  schema: 1;
  id: string;
  request: WorkflowRequest;
  sourceHash: string;
  state: "running" | "paused" | "failed" | "awaiting-author";
  created: string;
  updated: string;
  steps: WorkflowStep[];
  basis: string;
  error?: string;
  reason?: WorkflowReason;
}
/** A finished plan or article report the author has not adopted yet. */
export function canApply(record: WorkflowRecord) {
  return (
    record.state === "awaiting-author" &&
    (record.request.kind === "book" || record.request.kind === "article") &&
    !record.steps.some((step) => step.id === "author-application" && step.status === "complete")
  );
}
/**
 * A run the author can still continue (running, paused, failed) or adopt. Pointing the work at
 * another run would leave it unreachable.
 */
export function isUnfinishedRun(record: WorkflowRecord) {
  return record.state !== "awaiting-author" || canApply(record);
}
export const emptyUsage = (): WorkflowUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: null,
});
/** 是否真的调用过模型：本地步骤四项都是 0。 */
export function hasUsage(usage: WorkflowUsage) {
  return usage.input + usage.output + usage.cacheRead + usage.cacheWrite > 0;
}

/**
 * Adds one call's usage to a stage total; an unknown cost on a call that used tokens keeps the
 * total unknown. A call without tokens (a local step, a request refused before billing) adds
 * nothing, so it cannot turn a known cost into an unknown one.
 */
export function addUsage(total: WorkflowUsage, next: WorkflowUsage): WorkflowUsage {
  if (!hasUsage(next)) return total;
  if (!hasUsage(total)) return next;
  return {
    input: total.input + next.input,
    output: total.output + next.output,
    cacheRead: total.cacheRead + next.cacheRead,
    cacheWrite: total.cacheWrite + next.cacheWrite,
    cost: next.cost === null || total.cost === null ? null : total.cost + next.cost,
  };
}

function inputUnits(text: string) {
  let units = 0;
  for (const char of text) units += char.charCodeAt(0) < 128 ? 0.25 : 1;
  return units;
}
export function estimateInput(text: string) {
  return Math.ceil(inputUnits(text));
}
export interface ContextBlock {
  name: string;
  text: string;
  required: boolean;
}
export function contextPacket(stable: ContextBlock[], variable: ContextBlock[], limit: number) {
  const omitted: string[] = [],
    blocks = [...stable, ...variable];
  const required = blocks.filter((block) => block.required && block.text.trim());
  const serialize = (items: ContextBlock[]) =>
    items
      .filter((block) => block.text.trim())
      .map((block) => `## ${block.name}\n${block.text}`)
      .join("\n\n");
  if (estimateInput(serialize(required)) > limit)
    throw new WorkflowPause(
      "stage-budget",
      "阶段上下文超预算；请缩小任务或调整预算，未截断关键材料",
    );
  const accepted = new Set(required);
  const occurrences = new Map<ContextBlock, number>();
  for (const block of blocks) occurrences.set(block, (occurrences.get(block) ?? 0) + 1);
  let units = required.reduce(
    (sum, block) => sum + inputUnits(`## ${block.name}\n${block.text}`) + 0.5,
    -0.5,
  );
  // Prefix-stable selection: once one optional block does not fit, every later optional block
  // yields too, so stages of one run differ only at the tail of their shared prefix. Callers
  // order optional material from most to least important.
  let full = false;
  for (const block of blocks)
    if (!block.required && block.text.trim()) {
      const addition = accepted.has(block)
        ? 0
        : (inputUnits(`## ${block.name}\n${block.text}`) + 0.5) * (occurrences.get(block) ?? 1);
      if (!full && Math.ceil(units + addition) <= limit) {
        accepted.add(block);
        units += addition;
      } else {
        full = true;
        omitted.push(block.name);
      }
    }
  const keep = (items: ContextBlock[]) => items.filter((block) => accepted.has(block));
  // The stable part becomes the request's system prompt (a cache breakpoint on Claude-style
  // APIs); the variable part is the user message. Joined, they equal the whole packet.
  const prefix = serialize(keep(stable)),
    suffix = serialize(keep(variable));
  const text = [prefix, suffix].filter(Boolean).join("\n\n");
  return { text, prefix, suffix, omitted, tokens: estimateInput(text) };
}
