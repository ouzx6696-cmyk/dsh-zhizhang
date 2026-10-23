export declare function allTools(): {
    name: any;
    description: any;
    parameters: {
        type: string;
        additionalProperties: boolean;
        properties: any;
        required: any;
    };
    output: {
        schema: {
            type: string;
        };
        render: (_args: any, value: string) => {
            type: string;
            text: string;
        }[];
    };
    execute(args: any, exec: import("./types.js").ExecContext): Promise<any>;
}[];
export { defineTool } from "./types.js";
export { SYSTEM_BRIEF } from "./brief.js";
export { setPluginConfig, config } from "./context.js";
export { formatLint } from "./render.js";
