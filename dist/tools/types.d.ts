import type { ExecContext } from "../lib/types.js";
export type { ExecContext };
export declare function defineTool(def: any): {
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
    execute(args: any, exec: ExecContext): Promise<any>;
};
