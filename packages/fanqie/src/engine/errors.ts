import { WriterError } from "../../../core/src/tool.js";
import { errorText } from "../../../core/src/errors.js";
/** User/agent-facing errors: Chinese message only, never stack traces. */
export class NovelError extends Error {
    code;
    constructor(code: string, message: string) {
        super(message);
        this.name = "NovelError";
        this.code = code;
    }
}
/** Flatten any thrown value into a short Chinese line for tool output. */
export function formatToolError(err: unknown) {
    if (err instanceof NovelError || err instanceof WriterError)
        return `错误[${err.code}]：${err.message}`;
    if (err instanceof Error) {
        const msg = (err.message || "未知错误").split("\n")[0].slice(0, 400);
        return `错误：${msg}`;
    }
    return `错误：${String(err).slice(0, 200)}`;
}

export function toErrorResult(error: NovelError | WriterError) {
    return {ok:false as const, code:error.code, error:errorText(error)};
}
