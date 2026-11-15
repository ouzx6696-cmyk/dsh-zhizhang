/**
 * 助手工具的执行适配：core ToolDefinition → 模型可见的工具声明；执行一律经 executeTool。
 * executeTool 对业务错误返回 ok:false；对 infra/bug 抛出——此处记为 isError，任务步骤不计完成。
 */
import { classify } from "@zhizhang/core/errors";
import { executeTool, type ToolCtx, type ToolDefinition } from "@zhizhang/core/tool";
import type { AgentToolCall, AssistantToolSpec } from "./types.js";

export function toolSpecs(tools: ToolDefinition[]): AssistantToolSpec[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.jsonSchema,
  }));
}

export interface ToolOutcome {
  text: string;
  isError: boolean;
  /** 发起流水线类工具返回的运行 id。 */
  runId?: string;
  pipeline?: string;
}

function runInfo(value: object): { runId?: string; pipeline?: string } {
  const runId = "runId" in value && typeof value.runId === "string" ? value.runId : undefined;
  const pipeline = "kind" in value && typeof value.kind === "string" ? value.kind : undefined;
  return runId ? { runId, ...(pipeline ? { pipeline } : {}) } : {};
}

export async function runTool(
  tools: ToolDefinition[],
  call: AgentToolCall,
  ctx: ToolCtx,
): Promise<ToolOutcome> {
  const def = tools.find((tool) => tool.name === call.name);
  if (!def) {
    return {
      text: JSON.stringify({
        ok: false,
        code: "input.not_found",
        message: `没有工具 ${call.name}`,
      }),
      isError: true,
    };
  }
  try {
    const result = await executeTool(def, call.args, ctx);
    if (!result.ok) {
      return { text: JSON.stringify(result), isError: true };
    }
    const { ok: _ok, ...value } = result;
    const text = def.render ? def.render(value) : JSON.stringify(value);
    return { text, isError: false, ...runInfo(value) };
  } catch (err) {
    const appErr = classify(err);
    return {
      text: JSON.stringify({ ok: false, code: appErr.code, message: appErr.message }),
      isError: true,
    };
  }
}
