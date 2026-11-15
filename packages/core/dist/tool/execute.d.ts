import type { ToolCtx, ToolDefinition, ToolResult } from "./define.js";
export declare function executeTool<A, V extends object>(def: ToolDefinition<A, V>, rawArgs: unknown, ctx: ToolCtx): Promise<ToolResult<V>>;
//# sourceMappingURL=execute.d.ts.map