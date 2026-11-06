export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Node fs 调用的错误对象带 errno 的 code 字段；按码识别才允许降级。 */
export function isFsError(error: unknown, code: string) {
  return error instanceof Error && "code" in error && error.code === code;
}

export function isMissingFileError(error: unknown) {
  return isFsError(error, "ENOENT");
}
