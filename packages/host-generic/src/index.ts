/** Transport-independent tool execution. No SDK, HTTP or window dependencies. */
import type {
  HostToolDefinition,
  HostToolExecution,
} from "../../host/src/index.js";
import type { GateEngine } from "../../core/src/gates.js";

export async function executeTool(
  definition: HostToolDefinition,
  input: Record<string, unknown>,
  execution: HostToolExecution,
  options: {
    gates: GateEngine;
    bind: <T>(run: () => Promise<T>) => Promise<T>;
    confirm: (message: string, signal?: AbortSignal) => Promise<boolean>;
  },
) {
  const decision = await options.bind(() => options.gates.evaluate(execution));
  if (decision?.kind === "deny" || decision?.kind === "cancel")
    throw new Error(decision.kind === "deny" ? decision.reason : "操作已取消");
  if (
    decision?.kind === "ask" &&
    !(await options.confirm(
      `${input.work || input.id || execution.cwd || ""}\n${decision.reason || "确认操作？"}`,
      execution.signal,
    ))
  )
    throw new Error("作者取消了操作");
  execution.signal?.throwIfAborted();
  const value = await options.bind(() => definition.execute(input, execution));
  return { value, content: definition.output.render(input, value) };
}
