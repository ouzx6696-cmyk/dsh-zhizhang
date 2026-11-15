import { CODES } from "./codes.js";
export class AppError extends Error {
    code;
    data;
    constructor(code, message, data) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.data = data;
    }
    get spec() {
        return CODES[this.code];
    }
}
export function isAppError(err, code) {
    if (!(err instanceof AppError))
        return false;
    return code === undefined ? true : err.code === code;
}
export function serializeError(err) {
    return err.data !== undefined
        ? { code: err.code, message: err.message, data: err.data }
        : { code: err.code, message: err.message };
}
