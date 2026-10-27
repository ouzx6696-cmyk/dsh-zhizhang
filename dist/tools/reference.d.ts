export declare function referenceTools(): {
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
