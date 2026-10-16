import { formatToolError } from "../lib/errors.js";

export type ToolDef = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    additionalProperties?: boolean;
    properties: Record<string, unknown>;
    required: string[];
  };
  output: {
    schema: { type: "string" };
    render: (args: unknown, value: string) => Array<{ type: "text"; text: string }>;
  };
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<string>;
};

export function defineTool(def: {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required?: string[];
  execute: (args: Record<string, unknown>, exec: unknown) => Promise<string>;
}): ToolDef {
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
      } catch (err) {
        return formatToolError(err);
      }
    },
  };
}
