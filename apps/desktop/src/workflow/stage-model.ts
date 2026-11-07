import path from "node:path";
import { runtimeModel } from "../session/pi-adapter";
import type { Sessions } from "../session/manager";
import type { WorkflowUsage } from "../../../../packages/core/src/workflow";

/** Fresh requests carry only a stage packet; model tools and inherited session history are absent. */
export async function stageModel(
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
