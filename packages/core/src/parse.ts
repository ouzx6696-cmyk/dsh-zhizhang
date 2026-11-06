/** 信任边界的收窄工具：HTTP body、IPC 参数、配置文件都先过这里。 */

/** 记录类型守卫：数组与 null 都不算记录。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 非字符串一律当空串，调用方按空串判断"没填"。 */
export function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
