import type { JsonSchemaNode, ToolDefinition } from "../../../../core/src/tool.js";
import { formatToolError } from "../errors.js";
import { asObject } from "../parse.js";
import type { ExecContext } from "../types.js";
export type { ExecContext };
interface ToolSpec {
  name: string;
  description: string;
  properties: Record<string, JsonSchemaNode>;
  required?: string[];
  execute(args: Record<string, unknown>, exec: ExecContext): Promise<string>;
}
export function defineTool(def: ToolSpec): ToolDefinition & { run: ToolDefinition["execute"] } {
  const run: ToolDefinition["execute"] = (args, exec) => def.execute(asObject(args), exec);
  return {
    run,
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
      render: (_args, value) => [{ type: "text", text: String(value) }],
    },
    async execute(args, exec) {
      try {
        return await run(args, exec);
      } catch (error) {
        return formatToolError(error);
      }
    },
  };
}
