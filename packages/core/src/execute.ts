/** Transport-independent tool execution. No SDK, HTTP or window dependencies. */
import { WriterError, type ToolDefinition, type ToolExecution, type ToolFailure } from "./tool.js";
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
  if (decision?.kind === "deny") throw new WriterError(decision.code, decision.reason);
  try {
    if (decision?.kind === "ask") {
      if (
        !(await options.confirm(
          `${input.work || input.id || execution.cwd}\n${decision.reason}`,
          execution.signal,
        ))
      )
        throw new WriterError("CANCELLED", "作者取消了操作");
      options.gates.approveConfirmation(execution);
    }
    execution.signal?.throwIfAborted();
    const value = await options.bind(() => definition.execute(input, execution));
    if (isFailure(value)) throw new WriterError(value.code, value.message);
    return { value, content: definition.output.render(input, value) };
  } finally {
    options.gates.discardConfirmation(execution);
  }
}

/** A writer tool reports a business failure as a value; see defineWriterTool. */
function isFailure(value: unknown): value is ToolFailure {
  return typeof value === "object" && value !== null && "ok" in value && value.ok === false;
}
