import { formatToolError } from "../errors.js";
import type { ExecContext } from "../types.js";

export type { ExecContext };
export function defineTool(def: any) {
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
                return formatToolError(err);
            }
        },
    };
}
