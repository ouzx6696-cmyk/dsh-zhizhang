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
        schema: {
            type: "string";
        };
        render: (args: unknown, value: string) => Array<{
            type: "text";
            text: string;
        }>;
    };
    execute: (args: Record<string, unknown>, exec: unknown) => Promise<string>;
};
export declare function defineTool(def: {
    name: string;
    description: string;
    properties: Record<string, unknown>;
    required?: string[];
    execute: (args: Record<string, unknown>, exec: unknown) => Promise<string>;
}): ToolDef;
