import { isAppError } from "../errors/app-error.js";
import { classify } from "../errors/classify.js";
import type { ToolCtx, ToolDefinition, ToolResult } from "./define.js";

export async function executeTool<A, V extends object>(
  def: ToolDefinition<A, V>,
  rawArgs: unknown,
  ctx: ToolCtx,
): Promise<ToolResult<V>> {
  try {
    const parsed = def.params(rawArgs, "$");
    const value = await def.run(parsed, ctx);
    return { ok: true, ...value };
  } catch (err) {
    const appErr = isAppError(err) ? err : classify(err);
    if (appErr.spec.kind === "infra" || appErr.spec.kind === "bug") {
      throw appErr;
    }
    return {
      ok: false,
      code: appErr.code,
      message: appErr.message,
    };
  }
}
