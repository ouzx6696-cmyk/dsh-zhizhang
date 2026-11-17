import type { ChangeScope } from "../shared/events.js";
import type { Target, RunDetail } from "../shared/views.js";
import { AppError } from "@zhizhang/core/errors";
import { transition, type RunRecord, type BudgetConfig } from "@zhizhang/core/pipeline";
export const SCOPE_BY_KIND: Record<string, ChangeScope> = {
  "fanqie.book": "pending",
  "fanqie.chapter": "chapter",
  "fanqie.review": "chapter",
  "fanqie.revise": "chapter",
  "fanqie.ledger": "pending",
  "fanqie.health": "bible",
  "fanqie.import": "imports",
  "library.dissect": "library",
  "toutiao.article": "article",
};

export function budgetFor(kind: string, request: unknown, budget: BudgetConfig): BudgetConfig {
  const estimate =
    request && typeof request === "object" && "estimate" in request ? request.estimate : undefined;
  if (
    kind !== "fanqie.import" ||
    !estimate ||
    typeof estimate !== "object" ||
    !("inputMax" in estimate) ||
    !("outputMax" in estimate)
  )
    return { ...budget, moneyCap: null };
  return {
    ...budget,
    moneyCap: null,
    runBudget: Math.min(
      10000000,
      Math.max(budget.runBudget, (Number(estimate.inputMax) + Number(estimate.outputMax)) * 2),
    ),
  };
}
export function importRetry(
  detail: RunDetail,
  chunks: number[],
  now: string,
  budget: BudgetConfig,
): RunRecord {
  if (
    detail.kind !== "fanqie.import" ||
    !["awaiting-author", "paused", "failed"].includes(detail.state)
  )
    throw new AppError("run.invalid_transition", "当前导入不能重试");
  if (!detail.request || typeof detail.request !== "object")
    throw new AppError("input.invalid", "导入请求损坏");
  const { error: _error, ...record } = detail;
  return {
    ...transition(record, "running", "retry", now),
    request: { ...detail.request, retryChunks: chunks },
    steps: record.steps.filter(
      (step) => step.id !== "locate" && step.id !== "resolve" && !step.id.startsWith("adjudicate-"),
    ),
    budget: { ...detail.budget, inputBudget: budget.inputBudget, moneyCap: null },
  };
}
export interface ActiveRun {
  target: Target;
  runId: string;
  kind: string;
  since: string;
  stage?: string;
  controller: AbortController;
  promise: Promise<RunDetail>;
}
