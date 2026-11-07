import { isRecord } from "./parse.js";

export class WorkflowBudgetError extends Error {}

const WORKFLOW_GRADES = ["economy", "standard", "premium"] as const;
export type WorkflowGrade = (typeof WORKFLOW_GRADES)[number];
export type WorkflowKind = "book" | "chapter" | "article" | "ledger";
export interface EngineSettings {
  guided: boolean;
  grade: WorkflowGrade;
  inputBudget: number;
  runBudget: number;
}
export const DEFAULT_ENGINE: EngineSettings = {
  guided: true,
  grade: "standard",
  inputBudget: 24000,
  runBudget: 200000,
};
export function parseEngine(value: unknown): EngineSettings {
  if (!isRecord(value)) throw new Error("写作引擎设置须为对象");
  if (
    Object.keys(value).some((key) => !["guided", "grade", "inputBudget", "runBudget"].includes(key))
  )
    throw new Error("写作引擎设置含未知字段");
  if (typeof value.guided !== "boolean" || !WORKFLOW_GRADES.includes(value.grade as WorkflowGrade))
    throw new Error("写作引擎模式或档位无效");
  for (const key of ["inputBudget", "runBudget"] as const)
    if (
      typeof value[key] !== "number" ||
      !Number.isInteger(value[key]) ||
      value[key] < 2000 ||
      value[key] > 1000000
    )
      throw new Error("上下文预算须为 2000–1000000 的整数");
  if (Number(value.runBudget) < Number(value.inputBudget))
    throw new Error("任务预算不能小于阶段预算");
  return {
    guided: value.guided,
    grade: value.grade as WorkflowGrade,
    inputBudget: Number(value.inputBudget),
    runBudget: Number(value.runBudget),
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
}
export const emptyUsage = (): WorkflowUsage => ({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: null,
});
export function estimateInput(text: string) {
  let units = 0;
  for (const char of text) units += char.charCodeAt(0) < 128 ? 0.25 : 1;
  return Math.ceil(units);
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
    throw new WorkflowBudgetError("阶段上下文超预算；请缩小任务或调整预算，未截断关键材料");
  const accepted = new Set(required);
  for (const block of blocks)
    if (!block.required && block.text.trim()) {
      const next = blocks.filter((value) => accepted.has(value) || value === block);
      if (estimateInput(serialize(next)) <= limit) accepted.add(block);
      else omitted.push(block.name);
    }
  const text = serialize(blocks.filter((block) => accepted.has(block)));
  return { text, omitted, tokens: estimateInput(text) };
}
