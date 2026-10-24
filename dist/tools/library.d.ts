import type { ExecContext } from "./types.js";
import type { StoragePaths } from "../lib/types.js";
export declare function openLibrary(exec: ExecContext, args: any): Promise<StoragePaths>;
export declare function libraryTools(): {
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
