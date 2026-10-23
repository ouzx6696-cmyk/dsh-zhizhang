import type { ExecContext } from "./types.js";
export declare function auditTools(): {
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
}[];
