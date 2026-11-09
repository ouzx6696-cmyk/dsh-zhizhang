import { isRecord } from "./parse.js";
import path from "node:path";
import { atomicWrite, nowIso, readJson } from "./fsx.js";
import {
  addUsage,
  emptyUsage,
  WORKFLOW_REASONS,
  WorkflowPause,
  parseWorkflowRequest,
  type WorkflowReason,
  type WorkflowRecord,
  type WorkflowRequest,
  type WorkflowStep,
  type WorkflowUsage,
} from "./workflow-config.js";
export * from "./workflow-config.js";

const RECORD_STATES: readonly WorkflowRecord["state"][] = [
  "running",
  "paused",
  "failed",
  "awaiting-author",
];
const STEP_STATUSES: readonly WorkflowStep["status"][] = ["running", "complete", "failed"];
function oneOf<T extends string>(choices: readonly T[], value: unknown): value is T {
  return choices.some((choice) => choice === value);
}
function parseUsage(value: unknown): WorkflowUsage {
  if (!isRecord(value)) throw new Error("流水线阶段记录损坏");
  const count = (key: "input" | "output" | "cacheRead" | "cacheWrite") => {
    const amount = value[key];
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)
      throw new Error("流水线用量损坏");
    return amount;
  };
  const cost = value.cost;
  if (cost !== null && (typeof cost !== "number" || !Number.isFinite(cost) || cost < 0))
    throw new Error("流水线费用损坏");
  return {
    input: count("input"),
    output: count("output"),
    cacheRead: count("cacheRead"),
    cacheWrite: count("cacheWrite"),
    cost,
  };
}
function parseStep(raw: unknown): WorkflowStep {
  if (
    !isRecord(raw) ||
    typeof raw.id !== "string" ||
    typeof raw.title !== "string" ||
    !oneOf(STEP_STATUSES, raw.status)
  )
    throw new Error("流水线阶段记录损坏");
  const usage = parseUsage(raw.usage);
  if (
    typeof raw.started !== "string" ||
    typeof raw.durationMs !== "number" ||
    raw.durationMs < 0 ||
    typeof raw.attempts !== "number" ||
    !Number.isInteger(raw.attempts) ||
    raw.attempts < 0
  )
    throw new Error("流水线阶段计时损坏");
  return {
    id: raw.id,
    title: raw.title,
    status: raw.status,
    started: raw.started,
    durationMs: raw.durationMs,
    attempts: raw.attempts,
    output: raw.output,
    usage,
    ...(typeof raw.error === "string" ? { error: raw.error } : {}),
    ...(typeof raw.model === "string" ? { model: raw.model } : {}),
  };
}
/**
 * Records written before the reason field carried their stop reason only in the message text.
 * They are read here once; everything past this boundary sees the structured reason.
 */
const LEGACY_REASONS: [RegExp, WorkflowReason][] = [
  [/余额不足/, "balance"],
  [/阶段上下文超预算/, "stage-budget"],
  [/任务输入预算/, "run-budget"],
  [/上次运行已中断/, "interrupted"],
  [/任务已暂停/, "stopped"],
];
function parseReason(value: Record<string, unknown>): WorkflowReason | undefined {
  if (value.reason !== undefined) {
    if (!oneOf(WORKFLOW_REASONS, value.reason)) throw new Error("流水线停止原因损坏");
    return value.reason;
  }
  if (typeof value.error !== "string") return undefined;
  const text = value.error;
  const legacy = LEGACY_REASONS.find(([pattern]) => pattern.test(text))?.[1];
  // Every legacy pause came from one of the sentences above or from the author stopping the run.
  return legacy ?? (value.state === "paused" ? "stopped" : undefined);
}
function parseRecord(value: unknown): WorkflowRecord {
  if (
    !isRecord(value) ||
    value.schema !== 1 ||
    typeof value.id !== "string" ||
    typeof value.sourceHash !== "string" ||
    !Array.isArray(value.steps)
  )
    throw new Error("流水线记录损坏，已保留原文件");
  if (!oneOf(RECORD_STATES, value.state)) throw new Error("流水线状态损坏");
  const request = parseWorkflowRequest(value.request);
  const steps = value.steps.map(parseStep);
  if (
    typeof value.basis !== "string" ||
    typeof value.created !== "string" ||
    typeof value.updated !== "string"
  )
    throw new Error("流水线时间损坏");
  if (new Set(steps.map((step) => step.id)).size !== steps.length)
    throw new Error("流水线阶段编号重复");
  const reason = parseReason(value);
  return {
    schema: 1,
    id: value.id,
    sourceHash: value.sourceHash,
    request,
    state: value.state,
    created: value.created,
    updated: value.updated,
    steps,
    basis: value.basis,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
    ...(reason ? { reason } : {}),
  };
}
/**
 * How a stage's answer is checked. `parse` checks structure only and must accept its own output,
 * because a resumed run re-reads the saved value through it. `accept` checks the answer against
 * the world as it is now (titles published since, the author's current outline) and may narrow it;
 * it runs only when the stage executes, so a stage that already completed is never rejected later
 * for something that changed while the run was paused.
 */
export interface StageCheck<T> {
  parse: (value: unknown) => T;
  accept?: (value: T) => T;
}
/** The journal records pure stage outputs before any delivery; delivery has its own idempotency receipt. */
export class WorkflowJournal {
  private constructor(
    readonly file: string,
    readonly record: WorkflowRecord,
    private publish: (record: WorkflowRecord) => void,
  ) {}
  static async open(
    file: string,
    request: WorkflowRequest,
    sourceHash: string,
    basis: string,
    publish: (record: WorkflowRecord) => void,
  ) {
    // Parsed on the way in as well as on the way back, so a record that opens is one that reopens.
    const wanted = parseWorkflowRequest(request);
    const raw = await readJson<unknown>(file);
    const record =
      raw === undefined
        ? {
            schema: 1 as const,
            id: path.basename(file, ".json"),
            request: wanted,
            sourceHash,
            state: "running" as const,
            created: nowIso(),
            updated: nowIso(),
            steps: [],
            basis,
          }
        : parseRecord(raw);
    if (
      record.sourceHash !== sourceHash ||
      JSON.stringify(record.request) !== JSON.stringify(wanted)
    )
      throw new Error("作品、来源或任务要求已改变，请新建任务；旧进度已保留");
    return new WorkflowJournal(file, record, publish);
  }
  static async read(file: string) {
    const raw = await readJson<unknown>(file);
    return raw === undefined ? undefined : parseRecord(raw);
  }
  private queue: Promise<void> = Promise.resolve();
  private dirty = false;
  /**
   * Saves are serialized and coalesced: a save that arrives while another write is in flight is
   * folded into the next write, and every write serializes the record at write time, so an older
   * snapshot can never land after a newer one when parallel stages save together.
   */
  async save() {
    this.record.updated = nowIso();
    this.dirty = true;
    // allow-catch: an earlier write's failure was already reported to the caller that awaited it.
    const write = this.queue
      .catch(() => undefined)
      .then(async () => {
        if (!this.dirty) return; // already written by a write queued ahead of this one
        this.dirty = false;
        const text = JSON.stringify(this.record, null, 2);
        try {
          await atomicWrite(this.file, text);
        } catch (error) {
          this.dirty = true; // let the next queued save retry the latest state
          throw error;
        }
      });
    this.queue = write;
    await write;
    this.publish(structuredClone(this.record));
  }
  async step<T>(
    id: string,
    title: string,
    check: StageCheck<T>,
    execute: (attempt: {
      index: number;
      lastError?: string;
    }) => Promise<{ value: unknown; usage: WorkflowUsage }>,
    signal: AbortSignal,
    retries = 1,
  ): Promise<T> {
    signal.throwIfAborted();
    let row = this.record.steps.find((step) => step.id === id);
    if (row?.status === "complete") return check.parse(row.output);
    if (!row) {
      row = {
        id,
        title,
        status: "running",
        started: nowIso(),
        durationMs: 0,
        attempts: 0,
        usage: emptyUsage(),
        output: null,
      };
      this.record.steps.push(row);
    }
    this.record.state = "running";
    delete this.record.error;
    delete this.record.reason;
    let lastError: string | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const started = Date.now();
      row.status = "running";
      row.started = nowIso();
      row.attempts++;
      delete row.error;
      await this.save();
      try {
        const result = await execute({ index: attempt, lastError });
        row.usage = addUsage(row.usage, result.usage);
        signal.throwIfAborted();
        const parsed = check.parse(result.value);
        const accepted = check.accept ? check.accept(parsed) : parsed;
        row.output = accepted;
        row.status = "complete";
        row.durationMs += Date.now() - started;
        await this.save();
        return accepted;
      } catch (error) {
        // A failed call can still have been billed (a truncated answer is the costly case).
        const lost = (error as { usage?: WorkflowUsage } | null)?.usage;
        if (lost) row.usage = addUsage(row.usage, lost);
        row.status = "failed";
        row.durationMs += Date.now() - started;
        row.error = error instanceof Error ? error.message : String(error);
        lastError = row.error;
        try {
          await this.save();
        } catch (saveError) {
          // The stage failure is the cause the author needs; keep it first next to the write failure.
          throw new AggregateError([error, saveError], row.error);
        }
        // Only content failures earn a second attempt. Provider retries already happened inside
        // the stage (transient), and a truncation or a provider refusal would repeat as is.
        const typed = error as { retryable?: unknown; kind?: unknown } | null;
        const fatal =
          error instanceof WorkflowPause ||
          typed?.retryable === false ||
          typed?.kind === "transient";
        if (signal.aborted || attempt === retries || fatal) throw error;
      }
    }
    throw new Error("阶段未完成");
  }
}
