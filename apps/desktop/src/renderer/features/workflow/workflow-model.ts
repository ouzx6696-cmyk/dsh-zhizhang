import {
  addUsage,
  emptyUsage,
  hasUsage,
  type WorkflowKind,
  type WorkflowReason,
  type WorkflowRecord,
  type WorkflowStep,
  type WorkflowUsage,
} from "../../../../../../packages/core/src/workflow-config.js";
import { isRecord } from "../../../../../../packages/core/src/parse.js";
import { COPY, WORKFLOW_COPY } from "../../../../../../packages/ui/src/copy.js";

export const KIND_LABEL: Record<WorkflowKind, string> = {
  book: COPY.workflowBook,
  chapter: COPY.workflowChapter,
  article: COPY.workflowArticle,
  ledger: COPY.workflowLedger,
};

export const STATE_LABEL: Record<WorkflowRecord["state"], string> = {
  running: COPY.workflowRunning,
  paused: COPY.workflowPaused,
  failed: COPY.workflowFailed,
  "awaiting-author": COPY.workflowReady,
};

/** 界面上的阶段状态：记录里的 running 只在整条流水线运行时才算“运行中”，否则是被中断。 */
export type Phase = "waiting" | "running" | "complete" | "failed" | "paused";

export interface StageRow {
  key: string;
  title: string;
  phase: Phase;
  steps: WorkflowStep[];
}

/** 越靠前越需要作者注意；一组并行阶段取最需要注意的那个状态。 */
const PHASE_RANK: Record<Phase, number> = {
  failed: 0,
  running: 1,
  paused: 2,
  waiting: 3,
  complete: 4,
};

/** 同一挑战者的读者投票并行执行，合成一行展示。 */
const GROUPS: { pattern: RegExp; title: (match: RegExpMatchArray) => string }[] = [
  { pattern: /^pair-(\d+)-/, title: (match) => WORKFLOW_COPY.voteGroup(Number(match[1])) },
];

export function stepPhase(step: WorkflowStep, record: WorkflowRecord): Phase {
  if (step.status !== "running") return step.status;
  return record.state === "running" ? "running" : "paused";
}

function groupOf(step: WorkflowStep) {
  for (const group of GROUPS) {
    const match = step.id.match(group.pattern);
    if (match) return { key: match[0], title: group.title(match) };
  }
  return { key: step.id, title: step.title };
}

export function stageRows(record: WorkflowRecord): StageRow[] {
  const rows = new Map<string, StageRow>();
  for (const step of record.steps) {
    const { key, title } = groupOf(step),
      phase = stepPhase(step, record),
      row = rows.get(key);
    if (!row) rows.set(key, { key, title, phase, steps: [step] });
    else {
      row.steps.push(step);
      if (PHASE_RANK[phase] < PHASE_RANK[row.phase]) row.phase = phase;
    }
  }
  return [...rows.values()];
}

/** 一个阶段的累计耗时（含之前的尝试），运行中的加上本次已走的时间。 */
export function stepElapsed(step: WorkflowStep, record: WorkflowRecord, now: number) {
  const live = stepPhase(step, record) === "running";
  return step.durationMs + (live ? Math.max(0, now - Date.parse(step.started)) : 0);
}

/** 多个阶段的墙钟耗时：并行阶段的时间段取并集，不重复累加。 */
export function spanElapsed(steps: WorkflowStep[], record: WorkflowRecord, now: number) {
  const spans = steps
    .map((step) => {
      const start = Date.parse(step.started);
      const end =
        stepPhase(step, record) === "running" ? Math.max(start, now) : start + step.durationMs;
      return [start, end] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    reached = -Infinity;
  for (const [start, end] of spans) {
    if (end <= reached) continue;
    total += end - Math.max(start, reached);
    reached = end;
  }
  return total;
}

export function rowElapsed(row: StageRow, record: WorkflowRecord, now: number) {
  return row.steps.length === 1
    ? stepElapsed(row.steps[0], record, now)
    : spanElapsed(row.steps, record, now);
}

/** 合计用量：只算真正调用过模型的阶段；其中任何一个费用未知，合计费用就是未知。 */
export function sumUsage(steps: WorkflowStep[]): WorkflowUsage {
  return steps
    .filter((step) => hasUsage(step.usage))
    .map((step) => step.usage)
    .reduce(addUsage, { ...emptyUsage(), cost: 0 });
}

/** 与运行时的预算检查同一口径：输入、缓存读取与缓存写入都计入任务输入预算。 */
export function inputTokens(usage: WorkflowUsage) {
  return usage.input + usage.cacheRead + usage.cacheWrite;
}

export function stageProgress(rows: StageRow[]) {
  return { done: rows.filter((row) => row.phase === "complete").length, total: rows.length };
}

/** 暂停或失败的原因由运行时记在记录上；只有停下来的任务才显示。 */
export function stopReason(record: WorkflowRecord): WorkflowReason | undefined {
  return record.state === "paused" || record.state === "failed" ? record.reason : undefined;
}

function deliveryOutput(record: WorkflowRecord) {
  const output = record.steps.find((step) => step.id === "delivery")?.output;
  return isRecord(output) ? output : undefined;
}

/** 交付稿仍带硬伤或无来源事实时，作者需要先看报告再决定。 */
export function deliveryOpen(record: WorkflowRecord) {
  return deliveryOutput(record)?.unresolved === true;
}

/** 交付回执里标为推荐的候选稿编号。 */
export function selectedCandidate(record: WorkflowRecord) {
  const candidates = deliveryOutput(record)?.candidates;
  if (!Array.isArray(candidates)) return undefined;
  const chosen = candidates.find((row) => isRecord(row) && row.selected === true);
  return isRecord(chosen) && typeof chosen.id === "string" ? chosen.id : undefined;
}

export { canApply } from "../../../../../../packages/core/src/workflow-config.js";
