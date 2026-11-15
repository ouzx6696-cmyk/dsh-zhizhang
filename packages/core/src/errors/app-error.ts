import { CODES, type CodeSpec, type ErrorCode } from "./codes.js";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly data?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.data = data;
  }

  get spec(): CodeSpec {
    return CODES[this.code];
  }
}

export function isAppError(err: unknown, code?: ErrorCode): err is AppError {
  if (!(err instanceof AppError)) return false;
  return code === undefined ? true : err.code === code;
}

export function serializeError(err: AppError): {
  code: ErrorCode;
  message: string;
  data?: Record<string, unknown>;
} {
  return err.data !== undefined
    ? { code: err.code, message: err.message, data: err.data }
    : { code: err.code, message: err.message };
}
