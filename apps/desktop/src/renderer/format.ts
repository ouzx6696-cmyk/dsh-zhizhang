/** 错误与数值的界面呈现：错误按码取文案，主进程消息作为细节附在后面。 */
import { CODES, isAppError, type ErrorCode } from "@zhizhang/core/errors";
import { ERROR_COPY } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";

function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CODES, value);
}

export function errorCode(error: unknown): ErrorCode {
  if (isAppError(error)) return error.code;
  const code: unknown =
    typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  return isErrorCode(code) ? code : "internal";
}

/** 一行给作者看的说明：码表文案 + 主进程给出的具体原因。 */
export function errorText(error: unknown): string {
  const title = ERROR_COPY[errorCode(error)];
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return detail && detail !== title ? `${title}：${detail}` : title;
}

export function notifyError(
  error: unknown,
  retry?: () => Promise<unknown>,
  retryLabel?: string,
): void {
  notify({
    tone: "danger",
    text: errorText(error),
    action:
      retry && retryLabel
        ? {
            label: retryLabel,
            run: () => retry().catch((next: unknown) => notifyError(next, retry, retryLabel)),
          }
        : undefined,
  });
}

/** 后台动作统一入口：失败转成通知，不抛给 React。 */
export function run(task: () => Promise<unknown>): void {
  task().catch((error: unknown) => notifyError(error));
}
