import { type CodeSpec, type ErrorCode } from "./codes.js";
export declare class AppError extends Error {
    readonly code: ErrorCode;
    readonly data?: Record<string, unknown>;
    constructor(code: ErrorCode, message: string, data?: Record<string, unknown>);
    get spec(): CodeSpec;
}
export declare function isAppError(err: unknown, code?: ErrorCode): err is AppError;
export declare function serializeError(err: AppError): {
    code: ErrorCode;
    message: string;
    data?: Record<string, unknown>;
};
//# sourceMappingURL=app-error.d.ts.map