import { formatToolError } from "../lib/errors.js";
export function defineTool(def) {
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
            render: (_args, value) => [{ type: "text", text: value }],
        },
        async execute(args, exec) {
            try {
                return await run(args ?? {}, exec);
            }
            catch (err) {
                return formatToolError(err);
            }
        },
    };
}
