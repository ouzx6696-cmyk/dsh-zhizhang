import { AppError, isAppError } from "./app-error.js";
import type { ErrorCode } from "./codes.js";

interface NodeErrnoLike {
  code?: unknown;
  status?: unknown;
  statusCode?: unknown;
  name?: unknown;
  message?: unknown;
}

const ERRNO_MAP: Record<string, ErrorCode> = {
  ENOENT: "input.not_found",
  ENOTDIR: "input.not_found",
  EBUSY: "storage.locked",
  EPERM: "storage.locked",
  EAGAIN: "storage.locked",
  EACCES: "storage.io",
  EIO: "storage.io",
  ENOSPC: "storage.io",
  EROFS: "storage.io",
  ENOTFOUND: "network.proxy",
  ECONNREFUSED: "network.proxy",
  ECONNRESET: "network.proxy",
  ETIMEDOUT: "model.unavailable",
};

const HTTP_STATUS_MAP: Record<number, ErrorCode> = {
  401: "model.auth",
  402: "model.balance",
  403: "model.auth",
  408: "model.unavailable",
  413: "model.context_overflow",
  429: "model.rate_limited",
  500: "model.unavailable",
  502: "model.unavailable",
  503: "model.unavailable",
  504: "model.unavailable",
};

export function classify(err: unknown, hint?: { provider?: boolean }): AppError {
  if (isAppError(err)) return err;

  const obj = (typeof err === "object" && err !== null ? err : {}) as NodeErrnoLike;
  const msg = typeof obj.message === "string" ? obj.message : String(err);

  if (obj.name === "AbortError") {
    return new AppError("run.stopped", msg);
  }

  const errno = typeof obj.code === "string" ? obj.code : undefined;
  if (errno && errno in ERRNO_MAP) {
    return new AppError(ERRNO_MAP[errno], msg, { errno });
  }

  const status =
    typeof obj.status === "number"
      ? obj.status
      : typeof obj.statusCode === "number"
        ? obj.statusCode
        : undefined;
  if (status !== undefined && status in HTTP_STATUS_MAP) {
    return new AppError(HTTP_STATUS_MAP[status], msg, { status });
  }

  if (hint?.provider) {
    return new AppError("model.unavailable", msg);
  }

  return new AppError("internal", msg);
}
