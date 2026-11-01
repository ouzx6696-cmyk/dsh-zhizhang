import type { HostToolDefinition } from '../../../../host/src/index.js';
import { formatToolError } from "../errors.js";
import type { ExecContext } from "../types.js";

export type { ExecContext };
export function defineTool(def: any): HostToolDefinition {
    const run = def.execute;
    return {
        name: def.name,
        description: def.description,
        parameters: {
            type: "object",
            additionalProperties: false,
            properties: def.properties,
            required: def.required ?? [],
        },
        output: {
            schema: { type: "string" },
            render: (_args: any, value: string) => [{ type: "text", text: value }],
        },
        async execute(args: any, exec: ExecContext) {
            try {
                return await run(args ?? {}, exec);
            }
            catch (err) {
                if (exec && Object.isExtensible(exec)) exec.failure = { code: String((err as any)?.code || "TOOL_FAILED"), message: err instanceof Error ? err.message : String(err) };
                return formatToolError(err);
            }
        },
    };
}
