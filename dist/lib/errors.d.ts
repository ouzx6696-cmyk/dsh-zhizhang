/** User/agent-facing errors: Chinese message only, never stack traces. */
export declare class ZhizhangError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** Flatten any thrown value into a short Chinese line for tool output. */
export declare function formatToolError(err: unknown): string;
