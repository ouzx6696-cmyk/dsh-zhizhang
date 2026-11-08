import path from "node:path";
import { isRetryableAssistantError, stageRuntimeModel } from "../session/pi-adapter";
import type { Sessions } from "../session/manager";
import { WorkflowBudgetError, type WorkflowUsage } from "../../../../packages/core/src/workflow";

/** Provider refusals that a later identical request can pass: rate limits, overload, gateway faults. */
const TRANSIENT =
  /\b(?:429|500|502|503|504|529)\b|rate.?limit|too many requests|overloaded|server busy|timed? ?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i;
/** Out-of-credit answers pause the run at a stage boundary instead of failing it. */
const NO_BALANCE =
  /\b402\b|insufficient[ _]balance|insufficient[ _]quota|quota exceeded|out of budget|billing|payment required|余额不足|欠费/i;
export const STAGE_BACKOFF_MS = [2000, 6000, 15000];
/** Bounds a hung connection well below the SDK default of 10 minutes. */
export const STAGE_TIMEOUT_MS = 6 * 60_000;
export function classifyStageError(message: string): "balance" | "transient" | "other" {
  if (NO_BALANCE.test(message)) return "balance";
  if (TRANSIENT.test(message)) return "transient";
  return "other";
}
/**
 * A model call that failed for a reason other than its content. `usage` carries what the provider
 * billed for the failed call; `retryable` is false when sending the same packet again cannot help.
 */
export class StageError extends Error {
  readonly retryable: boolean;
  constructor(
    message: string,
    readonly kind: "balance" | "transient" | "truncated" | "provider",
    readonly usage?: WorkflowUsage,
  ) {
    super(message);
    this.retryable = kind === "transient";
  }
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(signal.reason);
    }
    signal.addEventListener("abort", stop, { once: true });
  });
}
/**
 * The one retry layer for provider failures: transient ones back off with jitter inside one stage
 * attempt, and an out-of-credit answer becomes a resumable pause. Content failures are left to the
 * stage's own retry; a transient failure that outlasts the backoff is final for the stage.
 */
export async function withProviderRetry<T>(
  call: () => Promise<T>,
  signal: AbortSignal,
  delays: readonly number[] = STAGE_BACKOFF_MS,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (signal.aborted || error instanceof WorkflowBudgetError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      const kind =
        error instanceof StageError
          ? error.kind === "balance" || error.kind === "transient"
            ? error.kind
            : "other"
          : classifyStageError(message);
      if (kind === "balance")
        throw new WorkflowBudgetError(
          "模型服务余额不足，进度已保存并暂停；充值或更换模型连接后可恢复（" + message + "）",
        );
      if (kind !== "transient") throw error;
      if (attempt >= delays.length)
        throw error instanceof StageError ? error : new StageError(message, "transient");
      await wait(delays[attempt] * (0.8 + Math.random() * 0.4), signal);
    }
  }
}

/** One stage request: the run-constant prefix and the stage-specific suffix of a context packet. */
export interface StagePacket {
  prefix: string;
  suffix: string;
}
/** Fresh requests carry only a stage packet; model tools and inherited session history are absent. */
export async function stageModel(
  host: Pick<Sessions, "settings" | "home">,
  role: "writer" | "planner" | "editor",
  packet: StagePacket,
  signal: AbortSignal,
  extra: { sessionId?: string } = {},
): Promise<{ value: unknown; usage: WorkflowUsage }> {
  return withProviderRetry(() => stageRequest(host, role, packet, signal, extra), signal);
}
async function stageRequest(
  host: Pick<Sessions, "settings" | "home">,
  role: "writer" | "planner" | "editor",
  packet: StagePacket,
  signal: AbortSignal,
  extra: { sessionId?: string },
): Promise<{ value: unknown; usage: WorkflowUsage }> {
  signal.throwIfAborted();
  const models = host.settings(),
    settings = role === "planner" ? (models.planner ?? models.writer) : models[role];
  if (!settings.apiKey && !settings.keyless) throw new Error("请先配置阶段模型连接");
  const { runtime, model } = await stageRuntimeModel(
    settings,
    path.join(host.home, "agent/auth.json"),
    role,
  );
  signal.throwIfAborted();
  // The prefix goes in the system prompt so Claude-style APIs can place a cache breakpoint after
  // it; sessionId keys OpenAI-style prompt caches and routing. SDK retries are off: withProviderRetry
  // is the only retry layer.
  const answer = await runtime.completeSimple(
    model,
    {
      systemPrompt: packet.prefix,
      messages: [{ role: "user", content: packet.suffix, timestamp: Date.now() }],
    },
    {
      signal,
      maxTokens: settings.maxTokens,
      reasoning: settings.thinkingLevel === "off" ? undefined : settings.thinkingLevel,
      ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
      maxRetries: 0,
      timeoutMs: STAGE_TIMEOUT_MS,
    },
  );
  const usage = {
    input: answer.usage.input,
    output: answer.usage.output,
    cacheRead: answer.usage.cacheRead,
    cacheWrite: answer.usage.cacheWrite,
    cost:
      model.cost.input + model.cost.output + model.cost.cacheRead + model.cost.cacheWrite > 0
        ? answer.usage.cost.total
        : null,
  };
  const content = answer.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (answer.stopReason === "aborted")
    throw new Error(answer.errorMessage || "阶段模型停止，未交付完整结果");
  if (answer.stopReason === "error") {
    const message = answer.errorMessage || "阶段模型停止，未交付完整结果";
    throw new StageError(
      message,
      NO_BALANCE.test(message)
        ? "balance"
        : isRetryableAssistantError(answer) || TRANSIENT.test(message)
          ? "transient"
          : "provider",
      usage,
    );
  }
  // Truncation is deterministic for the same packet and output cap: fail once, keep the usage.
  if (answer.stopReason === "length")
    throw new StageError("阶段输出被截断，请调整模型输出上限或缩小任务", "truncated", usage);
  return { value: content, usage };
}
