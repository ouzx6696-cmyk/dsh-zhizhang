import { isRecord } from "./parse.js";
import path from "node:path";
import { atomicWrite, nowIso, readJson } from "./fsx.js";
import {
  addUsage,
  emptyUsage,
  WorkflowBudgetError,
  parseWorkflowRequest,
  type WorkflowRecord,
  type WorkflowRequest,
  type WorkflowStep,
  type WorkflowUsage,
} from "./workflow-config.js";
export * from "./workflow-config.js";

function parseRecord(value: unknown): WorkflowRecord {
  if (
    !isRecord(value) ||
    value.schema !== 1 ||
    typeof value.id !== "string" ||
    typeof value.sourceHash !== "string" ||
    !Array.isArray(value.steps)
  )
    throw new Error("流水线记录损坏，已保留原文件");
  if (!["running", "paused", "failed", "awaiting-author"].includes(String(value.state)))
    throw new Error("流水线状态损坏");
  parseWorkflowRequest(value.request);
  for (const step of value.steps) {
    if (
      !isRecord(step) ||
      typeof step.id !== "string" ||
      typeof step.title !== "string" ||
      !["running", "complete", "failed"].includes(String(step.status)) ||
      !isRecord(step.usage)
    )
      throw new Error("流水线阶段记录损坏");
    for (const key of ["input", "output", "cacheRead", "cacheWrite"])
      if (
        typeof step.usage[key] !== "number" ||
        !Number.isFinite(step.usage[key]) ||
        Number(step.usage[key]) < 0
      )
        throw new Error("流水线用量损坏");
    if (
      step.usage.cost !== null &&
      (typeof step.usage.cost !== "number" ||
        !Number.isFinite(step.usage.cost) ||
        step.usage.cost < 0)
    )
      throw new Error("流水线费用损坏");
  }
  if (
    typeof value.basis !== "string" ||
    typeof value.created !== "string" ||
    typeof value.updated !== "string"
  )
    throw new Error("流水线时间损坏");
  if (new Set(value.steps.map((step) => step.id)).size !== value.steps.length)
    throw new Error("流水线阶段编号重复");
  const steps: WorkflowStep[] = value.steps.map((raw) => {
    if (!isRecord(raw) || !isRecord(raw.usage)) throw new Error("流水线阶段损坏");
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
      id: String(raw.id),
      title: String(raw.title),
      status: raw.status as WorkflowStep["status"],
      started: raw.started,
      durationMs: raw.durationMs,
      attempts: raw.attempts,
      output: raw.output,
      usage: {
        input: Number(raw.usage.input),
        output: Number(raw.usage.output),
        cacheRead: Number(raw.usage.cacheRead),
        cacheWrite: Number(raw.usage.cacheWrite),
        cost: raw.usage.cost === null ? null : Number(raw.usage.cost),
      },
      ...(typeof raw.error === "string" ? { error: raw.error } : {}),
      ...(typeof raw.model === "string" ? { model: raw.model } : {}),
    };
  });
  return {
    schema: 1,
    id: value.id,
    sourceHash: value.sourceHash,
    request: parseWorkflowRequest(value.request),
    state: value.state as WorkflowRecord["state"],
    created: value.created,
    updated: value.updated,
    steps,
    basis: value.basis,
    ...(typeof value.error === "string" ? { error: value.error } : {}),
  };
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
    const raw = await readJson<unknown>(file);
    const record =
      raw === undefined
        ? {
            schema: 1 as const,
            id: path.basename(file, ".json"),
            request,
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
      JSON.stringify(record.request) !== JSON.stringify(request)
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
    parse: (value: unknown) => T,
    execute: (attempt: {
      index: number;
      lastError?: string;
    }) => Promise<{ value: unknown; usage: WorkflowUsage }>,
    signal: AbortSignal,
    retries = 1,
  ): Promise<T> {
    signal.throwIfAborted();
    let row = this.record.steps.find((step) => step.id === id);
    if (row?.status === "complete") return parse(row.output);
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
        const parsed = parse(result.value);
        row.output = parsed;
        row.status = "complete";
        row.durationMs += Date.now() - started;
        await this.save();
        return parsed;
      } catch (error) {
        // A failed call can still have been billed (a truncated answer is the costly case).
        const lost = (error as { usage?: WorkflowUsage } | null)?.usage;
        if (lost) row.usage = addUsage(row.usage, lost);
        row.status = "failed";
        row.durationMs += Date.now() - started;
        row.error = error instanceof Error ? error.message : String(error);
        lastError = row.error;
        await this.save();
        // Only content failures earn a second attempt. Provider retries already happened inside
        // the stage (transient), and a truncation or a provider refusal would repeat as is.
        const typed = error as { retryable?: unknown; kind?: unknown } | null;
        const fatal =
          error instanceof WorkflowBudgetError ||
          typed?.retryable === false ||
          typed?.kind === "transient";
        if (signal.aborted || attempt === retries || fatal) throw error;
      }
    }
    throw new Error("阶段未完成");
  }
}
