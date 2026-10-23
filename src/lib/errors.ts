/** User/agent-facing errors: Chinese message only, never stack traces. */
export class ZhizhangError extends Error {
    code;
    constructor(code: any, message: string) {
        super(message);
        this.name = "ZhizhangError";
        this.code = code;
    }
}
/** Flatten any thrown value into a short Chinese line for tool output. */
export function formatToolError(err: any) {
    if (err instanceof ZhizhangError)
        return `错误[${err.code}]：${err.message}`;
    if (err instanceof Error) {
        const msg = (err.message || "未知错误").split("\n")[0].slice(0, 400);
        return `错误：${msg}`;
    }
    return `错误：${String(err).slice(0, 200)}`;
}
