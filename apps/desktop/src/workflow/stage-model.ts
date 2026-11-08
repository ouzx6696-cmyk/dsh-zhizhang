import path from "node:path";
import { runtimeModel } from "../session/pi-adapter";
import type { Sessions } from "../session/manager";
import { WorkflowBudgetError, type WorkflowUsage } from "../../../../packages/core/src/workflow";

/** Provider refusals that a later identical request can pass: rate limits, overload, gateway faults. */
const TRANSIENT =
  /\b(?:429|500|502|503|504|529)\b|rate.?limit|too many requests|overloaded|server busy|timed? ?out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed/i;
/** Out-of-credit answers pause the run at a stage boundary instead of failing it. */
const NO_BALANCE =
  /\b402\b|insufficient[ _]balance|insufficient[ _]quota|payment required|余额不足|欠费/i;
export const STAGE_BACKOFF_MS = [2000, 6000, 15000];
export function classifyStageError(message: string): "balance" | "transient" | "other" {
  if (NO_BALANCE.test(message)) return "balance";
  if (TRANSIENT.test(message)) return "transient";
  return "other";
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
 * Retries transient provider failures with backoff inside one stage attempt, and turns an
 * out-of-credit answer into a resumable pause. Content failures are left to the stage's own retry.
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
      const message = error instanceof Error ? error.message : String(error);
      const kind = classifyStageError(message);
      if (kind === "balance")
        throw new WorkflowBudgetError(
          "模型服务余额不足，进度已保存并暂停；充值或更换模型连接后可恢复（" + message + "）",
        );
      if (kind !== "transient" || attempt >= delays.length) throw error;
      await wait(delays[attempt], signal);
    }
  }
}

/** Fresh requests carry only a stage packet; model tools and inherited session history are absent. */
export async function stageModel(
  host: Sessions,
  role: "writer" | "planner" | "editor",
  packet: string,
  signal: AbortSignal,
): Promise<{ value: unknown; usage: WorkflowUsage }> {
  return withProviderRetry(() => stageRequest(host, role, packet, signal), signal);
}
async function stageRequest(
  host: Sessions,
  role: "writer" | "planner" | "editor",
  packet: string,
  signal: AbortSignal,
): Promise<{ value: unknown; usage: WorkflowUsage }> {
  signal.throwIfAborted();
  const models = host.settings(),
    settings = role === "planner" ? (models.planner ?? models.writer) : models[role];
  if (!settings.apiKey && !settings.keyless) throw new Error("请先配置阶段模型连接");
  const { runtime, model } = await runtimeModel(
    settings,
    path.join(host.home, "agent/auth.json"),
    role,
  );
  signal.throwIfAborted();
  const answer = await runtime.completeSimple(
    model,
    {
      messages: [{ role: "user", content: packet, timestamp: Date.now() }],
    },
    {
      signal,
      maxTokens: settings.maxTokens,
      reasoning: settings.thinkingLevel === "off" ? undefined : settings.thinkingLevel,
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
  if (answer.stopReason === "error" || answer.stopReason === "aborted")
    throw new Error(answer.errorMessage || "阶段模型停止，未交付完整结果");
  if (answer.stopReason === "length")
    throw new Error("阶段输出被截断，请调整模型输出上限或缩小任务");
  return { value: content, usage };
}
