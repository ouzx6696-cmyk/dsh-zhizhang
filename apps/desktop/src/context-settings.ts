export type ContextSettings = {
  enabled: boolean;
  triggerPercent: number;
  budget: number;
  keepRecentTokens: number;
};
export const DEFAULT_CONTEXT: ContextSettings = {
  enabled: true,
  triggerPercent: 80,
  budget: 0,
  keepRecentTokens: 20000,
};
export function parseContextSettings(value: unknown): ContextSettings {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("上下文设置须为对象");
  const row = value as Record<string, unknown>;
  if (typeof row.enabled !== "boolean") throw new Error("自动压缩开关无效");
  for (const key of ["triggerPercent", "budget", "keepRecentTokens"]) {
    const n = row[key];
    if (typeof n !== "number" || !Number.isSafeInteger(n)) throw new Error("上下文预算须为整数");
  }
  const result = row as ContextSettings;
  if (
    result.triggerPercent < 50 ||
    result.triggerPercent > 95 ||
    result.budget < 0 ||
    (result.budget > 0 && result.budget < 4096) ||
    result.keepRecentTokens < 0
  )
    throw new Error("压缩触发比例须为 50–95%，预算至少 4096，近期保留量不能为负");
  return {
    enabled: result.enabled,
    triggerPercent: result.triggerPercent,
    budget: result.budget,
    keepRecentTokens: result.keepRecentTokens,
  };
}
export function compactionSettings(value: ContextSettings, window: number, output: number) {
  const threshold = Math.min(
    Math.floor((window * value.triggerPercent) / 100),
    window - Math.max(output, Math.min(16384, Math.floor(window / 4))),
    value.budget || window,
  );
  if (threshold < 2048) throw new Error("模型输出预算过大，无法为上下文和压缩保留空间");
  return {
    enabled: value.enabled,
    reserveTokens: window - threshold,
    keepRecentTokens: Math.min(value.keepRecentTokens, Math.floor(threshold / 2)),
  };
}

/** 主动压缩判定（session.proactiveCompact）：任务结算空闲后上下文已达窗口 75%；
 * PI 自己的阈值按设置的 triggerPercent（默认 80%）计算，75% 保证我们先整理。窗口无效或用量未知时不触发。 */
export function shouldProactivelyCompact(
  usage: { tokens: number | null; contextWindow: number } | undefined,
) {
  return (
    !!usage &&
    usage.contextWindow > 0 &&
    usage.tokens !== null &&
    usage.tokens >= usage.contextWindow * 0.75
  );
}
