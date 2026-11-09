import path from "node:path";
import { providerErrorTraits, stageRuntimeModel } from "../session/pi-adapter";
import type { Sessions } from "../session/manager";
import { WorkflowPause, type WorkflowUsage } from "../../../../packages/core/src/workflow";
import { errorText } from "../../../../packages/core/src/errors";

/** Out-of-credit wording. OpenAI sends it with 429, Anthropic and Qwen with 400, so it wins over the status. */
const NO_BALANCE =
  /\b402\b|insufficient[ _]balance|insufficient[ _]quota|exceeded[ _]current[ _]quota|exceeded your current quota|quota exceeded|credit balance is too low|arrearage|out of budget|payment required|余额不足|欠费/i;
/** Only a status at the very start counts; a number inside the text ("≤ 500", "model-500") is not one. */
const LEADING_STATUS = /^\s*(\d{3})\b/;
export const STAGE_BACKOFF_MS = [2000, 6000, 15000];
/** Covers the request until its response headers arrive; the SDK clears it once the stream starts. */
const STAGE_TIMEOUT_MS = 6 * 60_000;

export type StageErrorKind =
  "balance" | "auth" | "context" | "transient" | "truncated" | "provider";
type ProviderErrorKind = Exclude<StageErrorKind, "truncated">;

/**
 * The one classifier for provider error text. The order is the contract: out-of-credit wording
 * first (it arrives under 400, 402 and 429), then the leading status, then pi-ai's overflow and
 * transient heuristics for what the status leaves open. Unknown errors fail rather than pause.
 */
export function classifyStageError(message: string): ProviderErrorKind {
  const status = Number(LEADING_STATUS.exec(message)?.[1] ?? 0);
  const denied = status === 401 || status === 403;
  if (NO_BALANCE.test(message) && !denied) return "balance";
  if (denied) return "auth";
  if (status === 408 || status === 429 || status >= 500) return "transient";
  const traits = providerErrorTraits(message);
  if (traits.overflow) return "context";
  if (status >= 400) return "provider";
  return traits.retryable ? "transient" : "provider";
}
/**
 * A model call that failed for a reason other than its content. `usage` carries what the provider
 * billed for the failed call; `retryable` is false when sending the same packet again cannot help.
 */
export class StageError extends Error {
  readonly retryable: boolean;
  constructor(
    message: string,
    readonly kind: StageErrorKind,
    readonly usage?: WorkflowUsage,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StageError";
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
/** The error that ends the stage when retrying cannot help. */
function finalFailure(error: StageError) {
  if (error.kind === "balance")
    return new WorkflowPause(
      "balance",
      `模型服务余额不足，进度已保存并暂停；充值或更换模型连接后可恢复（${error.message}）`,
    );
  if (error.kind === "context")
    return new WorkflowPause(
      "context",
      `阶段输入超出模型上下文窗口，进度已保存并暂停；可缩小任务、调低阶段输入预算或换用上下文更长的模型后恢复（${error.message}）`,
    );
  if (error.kind === "auth")
    return new StageError(
      `鉴权或权限失败，请检查 Key 与权限（${error.message}）`,
      "auth",
      error.usage,
      {
        cause: error,
      },
    );
  return error;
}
/**
 * The one retry layer for provider failures: transient ones back off with jitter inside one stage
 * attempt; out-of-credit and context overflow become resumable pauses. Content failures are left to
 * the stage's own retry; a transient failure that outlasts the backoff is final for the stage.
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
      if (signal.aborted) throw error;
      const failure =
        error instanceof StageError
          ? error
          : new StageError(errorText(error), classifyStageError(errorText(error)), undefined, {
              cause: error,
            });
      if (failure.kind !== "transient" || attempt >= delays.length) throw finalFailure(failure);
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
    throw new StageError(message, classifyStageError(message), usage);
  }
  // Truncation is deterministic for the same packet and output cap: fail once, keep the usage.
  if (answer.stopReason === "length")
    throw new StageError("阶段输出被截断，请调整模型输出上限或缩小任务", "truncated", usage);
  return { value: content, usage };
}
