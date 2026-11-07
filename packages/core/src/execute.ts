/** Transport-independent tool execution. No SDK, HTTP or window dependencies. */
import type { ToolDefinition, ToolExecution } from "./tool.js";
import type { GateEngine } from "./gates.js";

export async function executeTool(
  definition: ToolDefinition,
  input: Record<string, unknown>,
  execution: ToolExecution,
  options: {
    gates: GateEngine;
    bind: <T>(run: () => Promise<T>) => Promise<T>;
    confirm: (message: string, signal?: AbortSignal) => Promise<boolean>;
  },
) {
  if (typeof execution.cwd !== "string" || !execution.cwd.trim())
    throw new Error("工具执行缺少工作目录");
  execution = { ...execution, arguments: input };
  const decision = await options.bind(() => options.gates.evaluate(execution));
  if (decision?.kind === "deny" || decision?.kind === "cancel")
    throw new Error(decision.kind === "deny" ? decision.reason : "操作已取消");
  try {
    if (decision?.kind === "ask") {
      if (
        !(await options.confirm(
          `${input.work || input.id || execution.cwd}\n${decision.reason || "确认操作？"}`,
          execution.signal,
        ))
      )
        throw new Error("作者取消了操作");
      options.gates.approveConfirmation(execution);
    }
    execution.signal?.throwIfAborted();
    const value = await options.bind(() => definition.execute(input, execution));
    const failure =
      value && typeof value === "object" && "ok" in value && value.ok === false
        ? (value as { code?: string; message?: string })
        : undefined;
    if (failure)
      throw Object.assign(new Error(failure.message || "工具执行失败"), { code: failure.code });
    return { value, content: definition.output.render(input, value) };
  } finally {
    options.gates.discardConfirmation(execution);
  }
}
