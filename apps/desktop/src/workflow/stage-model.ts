import path from "node:path";
import { providerErrorTraits, stageRuntimeModel } from "../session/pi-adapter";
import type { Sessions } from "../session/manager";
import {
  WorkflowPause,
  addUsage,
  emptyUsage,
  type WorkflowUsage,
} from "../../../../packages/core/src/workflow";
import { errorText } from "../../../../packages/core/src/errors";

/**
 * Out-of-credit wording that no rate limit uses. OpenAI sends it with 429, Anthropic and Qwen with
 * 400, so it wins over the status.
 */
const NO_BALANCE =
  /insufficient[ _]balance|insufficient[ _]quota|exceeded your current quota|exceeded[ _]current[ _]quota|credit balance is too low|arrearage|out of budget|payment required|余额不足|欠费/i;
/**
 * Rate and per-window quota wording (Gemini RESOURCE_EXHAUSTED "Quota exceeded for metric … per
 * minute", DashScope Throttling.*): the window resets, so it is transient even when it says quota.
 */
const RATE_LIMITED =
  /rate[ _-]?limit|resource[ _]exhausted|throttl|too many requests|per[ _-]?(?:minute|second|hour|day)|requests? per|tokens? per|\b[RT]PM\b|限流|频率|请求过于频繁/i;
/** Generic quota wording; out of credit only when no rate-limit wording explains it. */
const QUOTA = /quota[ _]exceeded|exceeded[ _].*quota/i;
/** Only a status at the very start counts; a number inside the text ("≤ 500", "model-500") is not one. */
const LEADING_STATUS = /^\s*(\d{3})\b/;
const STAGE_BACKOFF_MS = [2000, 6000, 15000];
/**
 * A request that went silent gets one more attempt; a second silence on the same packet is final.
 * The SDK's own timeout ("Request timed out") counts as the same kind of silence.
 */
const SILENT_RETRIES = 1;
const SDK_TIMEOUT = /timed? ?out/i;
/**
 * Request sent to first progress event. A reasoning model may think for minutes before its first
 * token; the SDK's timeoutMs only runs until the response headers arrive, so this is enforced here.
 */
const FIRST_EVENT_MS = 6 * 60_000;
/** Between two progress events once the answer is streaming. */
const IDLE_MS = 150_000;
/** Stream events that show the model is still producing; `start` and keep-alives do not count. */
const PROGRESS = new Set(["text_delta", "thinking_delta", "toolcall_delta"]);

export type StageErrorKind =
  "balance" | "auth" | "context" | "transient" | "stalled" | "truncated" | "provider" | "aborted";
type ProviderErrorKind = Extract<
  StageErrorKind,
  "balance" | "auth" | "context" | "transient" | "provider"
>;

/**
 * The one classifier for provider error text. The order is the contract: unambiguous out-of-credit
 * wording first (it arrives under 400, 402 and 429), then rate-limit wording, then a leading 402 or
 * generic quota wording, then the leading status, then pi-ai's overflow and
 * transient heuristics for what the status leaves open. Unknown errors fail rather than pause.
 */
export function classifyStageError(message: string): ProviderErrorKind {
  const status = Number(LEADING_STATUS.exec(message)?.[1] ?? 0);
  const denied = status === 401 || status === 403;
  if (NO_BALANCE.test(message) && !denied) return "balance";
  if (denied) return "auth";
  if (RATE_LIMITED.test(message)) return "transient";
  if (status === 402 || QUOTA.test(message)) return "balance";
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
interface StageAnswer {
  value: unknown;
  usage: WorkflowUsage;
}
/** Resolves after `ms`, or as soon as the signal aborts; the caller checks which. */
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
function cancelled(signal: AbortSignal, usage: WorkflowUsage) {
  return new StageError("已取消", "aborted", usage, { cause: signal.reason });
}
function attemptsFor(error: StageError, delays: readonly number[]) {
  if (error.kind === "stalled" || (error.kind === "transient" && SDK_TIMEOUT.test(error.message)))
    return SILENT_RETRIES;
  return error.kind === "transient" ? delays.length : 0;
}
/** The error that ends the stage, carrying everything billed across its attempts. */
function finalFailure(error: StageError, billed: WorkflowUsage) {
  if (error.kind === "balance")
    return new WorkflowPause(
      "balance",
      `模型服务余额不足，进度已保存并暂停；充值或更换模型连接后可恢复（${error.message}）`,
      billed,
    );
  if (error.kind === "context")
    return new WorkflowPause(
      "context",
      `阶段输入超出模型上下文窗口，进度已保存并暂停；可缩小任务、调低阶段输入预算或换用上下文更长的模型后恢复（${error.message}）`,
      billed,
    );
  if (error.kind === "auth")
    return new StageError(`鉴权或权限失败，请检查 Key 与权限（${error.message}）`, "auth", billed, {
      cause: error,
    });
  return new StageError(error.message, error.kind, billed, { cause: error.cause });
}
/**
 * The one retry layer for provider failures: transient ones back off with jitter inside one stage
 * attempt, a silent stream is tried once more, out-of-credit and context overflow become resumable
 * pauses. Content failures are left to the stage's own retry. Usage billed by failed attempts is
 * added to the answer, or carried on the error that ends the stage.
 */
export async function withProviderRetry(
  call: () => Promise<StageAnswer>,
  signal: AbortSignal,
  delays: readonly number[] = STAGE_BACKOFF_MS,
): Promise<StageAnswer> {
  let billed = emptyUsage();
  for (let attempt = 0; ; attempt++) {
    let error: StageError;
    try {
      const answer = await call();
      return { value: answer.value, usage: addUsage(billed, answer.usage) };
    } catch (thrown) {
      error =
        thrown instanceof StageError
          ? thrown
          : new StageError(errorText(thrown), classifyStageError(errorText(thrown)), undefined, {
              cause: thrown,
            });
    }
    if (error.usage) billed = addUsage(billed, error.usage);
    // Whatever the attempt reported, the author's stop wins and keeps what was billed.
    if (signal.aborted) throw cancelled(signal, billed);
    if (attempt >= attemptsFor(error, delays)) throw finalFailure(error, billed);
    await wait(delays[attempt] * (0.8 + Math.random() * 0.4), signal);
    if (signal.aborted) throw cancelled(signal, billed);
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
): Promise<StageAnswer> {
  return withProviderRetry(() => stageRequest(host, role, packet, signal, extra), signal);
}
/**
 * Aborts a request whose stream stops making progress: no progress event within FIRST_EVENT_MS
 * of sending, or a gap longer than IDLE_MS after that. The author's own cancel is forwarded.
 */
function stallWatch(signal: AbortSignal) {
  const controller = new AbortController();
  let stalled: string | undefined;
  const stop = (why: string) => () => {
    stalled = why;
    controller.abort(new Error(why));
  };
  let timer = setTimeout(stop("6 分钟内没有开始输出"), FIRST_EVENT_MS);
  const forward = () => controller.abort(signal.reason);
  signal.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    stalled: () => stalled,
    progress() {
      clearTimeout(timer);
      timer = setTimeout(stop("输出中断超过 150 秒"), IDLE_MS);
    },
    close() {
      clearTimeout(timer);
      signal.removeEventListener("abort", forward);
    },
  };
}
async function stageRequest(
  host: Pick<Sessions, "settings" | "home">,
  role: "writer" | "planner" | "editor",
  packet: StagePacket,
  signal: AbortSignal,
  extra: { sessionId?: string },
): Promise<StageAnswer> {
  signal.throwIfAborted();
  const models = host.settings(),
    settings = role === "planner" ? (models.planner ?? models.writer) : models[role];
  // Configuration is not content: the stage's content retry must not resend into the same gap.
  if (!settings.apiKey && !settings.keyless)
    throw new StageError("请先配置阶段模型连接", "provider");
  const { runtime, model } = await stageRuntimeModel(
    settings,
    path.join(host.home, "agent/auth.json"),
    role,
  );
  signal.throwIfAborted();
  const watch = stallWatch(signal);
  let answer;
  try {
    // The prefix goes in the system prompt so Claude-style APIs can place a cache breakpoint after
    // it; sessionId keys OpenAI-style prompt caches and routing. SDK retries are off:
    // withProviderRetry is the only retry layer.
    const stream = runtime.streamSimple(
      model,
      {
        systemPrompt: packet.prefix,
        messages: [{ role: "user", content: packet.suffix, timestamp: Date.now() }],
      },
      {
        signal: watch.signal,
        maxTokens: settings.maxTokens,
        reasoning: settings.thinkingLevel === "off" ? undefined : settings.thinkingLevel,
        ...(extra.sessionId ? { sessionId: extra.sessionId } : {}),
        maxRetries: 0,
        timeoutMs: FIRST_EVENT_MS,
      },
    );
    for await (const event of stream) if (PROGRESS.has(event.type)) watch.progress();
    answer = await stream.result();
  } finally {
    watch.close();
  }
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
  if (answer.stopReason === "aborted" || answer.stopReason === "error") {
    const stalled = watch.stalled();
    if (stalled) throw new StageError(`模型长时间无输出（${stalled}）`, "stalled", usage);
    if (signal.aborted) throw cancelled(signal, usage);
    const message = answer.errorMessage || "阶段模型停止，未交付完整结果";
    throw new StageError(message, classifyStageError(message), usage);
  }
  // Truncation is deterministic for the same packet and output cap: fail once, keep the usage.
  if (answer.stopReason === "length")
    throw new StageError("阶段输出被截断，请调整模型输出上限或缩小任务", "truncated", usage);
  const content = answer.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return { value: content, usage };
}
