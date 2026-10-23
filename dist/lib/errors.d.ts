/** User/agent-facing errors: Chinese message only, never stack traces. */
export declare class ZhizhangError extends Error {
    code: any;
    constructor(code: any, message: string);
}
/** Flatten any thrown value into a short Chinese line for tool output. */
export declare function formatToolError(err: any): string;
