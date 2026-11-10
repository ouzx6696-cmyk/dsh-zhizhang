import {
  readingMetrics,
  readingWarnings,
  DEFAULT_READING_TARGETS,
} from "../../../../packages/fanqie/src/engine/reading-radar";
import { sha256 } from "../../../../packages/core/src/fsx";
import type { WorkflowRun } from "./run";

const cache = new WeakMap<WorkflowRun, Map<string, Promise<unknown>>>();
export function draftReading(run: WorkflowRun, body: string, targetWords = 0): Promise<unknown> {
  if (run.host.options.fanqie?.pursuit?.radar !== true) return Promise.resolve(undefined);
  let readings = cache.get(run);
  if (!readings) {
    readings = new Map();
    cache.set(run, readings);
  }
  const key = sha256(body + String(targetWords));
  const previous = readings.get(key);
  if (previous) return previous;
  const result = readingMetrics(
    [{ number: run.context.chapterPosition, body }],
    run.host.options.fanqie?.python,
  ).then(([metrics]) => ({
    metrics,
    warnings: readingWarnings(
      metrics,
      run.context.readingBenchmark?.targets ?? DEFAULT_READING_TARGETS,
      targetWords,
      run.context.readingBenchmark?.termDensityP90,
    ),
    ledgerWarnings: ledgerWarnings(run),
    note: "描述性量化提示，不代表AI判定或审读硬伤；对标密度尚未通过真书/AI稿区分度验证",
  }));
  readings.set(key, result);
  return result;
}

function ledgerWarnings(run: WorkflowRun) {
  const ledger = run.context.readingLedger;
  if (ledger === undefined) return [];
  const warnings: string[] = [];
  const cap = run.context.pace === "快爽" ? 3 : run.context.pace === "慢燃" ? 6 : 4;
  if (ledger.payoffCalendar.chaptersSince !== null && ledger.payoffCalendar.chaptersSince > cap)
    warnings.push(`距上次已记录兑现超过${cap}章，缺记录不能推断空转`);
  if (ledger.hooks.sameHookRun > 2) warnings.push("同类钩子连续超过2章");
  for (const row of ledger.characters.items)
    if (row.repeatOverdue || row.secondSideOverdue)
      warnings.push(`${row.name}的标签复现或第二面已到回看期`);
  for (const row of ledger.threads.items)
    if (row.overdue) warnings.push(`${row.name}超过建议回收章序`);
  return warnings;
}
