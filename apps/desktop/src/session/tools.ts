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

const MAX_TOOL_OUTPUT_CHARS = 24_000;

function clipToolOutput(text: string): string {
  if (text.length <= MAX_TOOL_OUTPUT_CHARS) return text;
  const omitted = text.length - MAX_TOOL_OUTPUT_CHARS;
  return `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…（工具返回已截断，省略 ${omitted} 字符）`;
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
      return { text: clipToolOutput(JSON.stringify(result)), isError: true };
    }
    const { ok: _ok, ...value } = result;
    const raw = def.render ? def.render(value) : JSON.stringify(value);
    return { text: clipToolOutput(raw), isError: false, ...runInfo(value) };
  } catch (err) {
    const appErr = classify(err);
    return {
      text: JSON.stringify({ ok: false, code: appErr.code, message: appErr.message }),
      isError: true,
    };
  }
}

export interface ToolBatchCallbacks {
  onBatchStart(names: string[]): void;
  onToolStart(call: AgentToolCall): void;
  onToolEnd(call: AgentToolCall, outcome: ToolOutcome): void;
}

/** 连续无副作用只读工具并发批处理，其余工具严格串行执行。 */
export async function executeToolBatch(
  tools: ToolDefinition[],
  toolCalls: readonly AgentToolCall[],
  ctx: ToolCtx,
  cb: ToolBatchCallbacks,
): Promise<void> {
  const toolMap = new Map(tools.map((tool) => [tool.name, tool]));
  const isReadonly = (name: string) => toolMap.get(name)?.readonly === true;
  let idx = 0;
  while (idx < toolCalls.length) {
    const first = toolCalls[idx];
    if (isReadonly(first.name)) {
      const batch = [first];
      while (
        idx + batch.length < toolCalls.length &&
        isReadonly(toolCalls[idx + batch.length].name)
      ) {
        batch.push(toolCalls[idx + batch.length]);
      }
      idx += batch.length;
      cb.onBatchStart(batch.map((c) => c.name));
      for (const call of batch) cb.onToolStart(call);
      const outcomes = await Promise.all(
        batch.map(async (call) => ({ call, outcome: await runTool(tools, call, ctx) })),
      );
      for (const { call, outcome } of outcomes) cb.onToolEnd(call, outcome);
    } else {
      idx += 1;
      cb.onBatchStart([first.name]);
      cb.onToolStart(first);
      const outcome = await runTool(tools, first, ctx);
      cb.onToolEnd(first, outcome);
    }
  }
}
