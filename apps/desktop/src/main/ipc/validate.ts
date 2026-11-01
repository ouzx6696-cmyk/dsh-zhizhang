import type { Focus, Target } from "../../context";

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`参数无效：${label}应为对象`);
  return value as Record<string, unknown>;
}

export function parseMode(value: unknown): Target["mode"] {
  if (value !== "fanqie" && value !== "toutiao") throw new Error("未知模式");
  return value;
}

export function parseTarget(value: unknown): Target {
  const source = asRecord(value, "作品目标");
  if (typeof source.root !== "string" || !source.root.trim())
    throw new Error("参数无效：作品目录");
  return {
    mode: parseMode(source.mode),
    root: source.root,
    ...(typeof source.work === "string" && source.work ? { work: source.work } : {}),
  };
}

export function parseFocus(value: unknown): Focus {
  if (value === undefined || value === null) return {};
  return asRecord(value, "任务对象") as Focus;
}

export function parseText(value: unknown): string {
  if (typeof value !== "string") throw new Error("参数无效：文本");
  return value;
}

export function parseOperation(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/"))
    throw new Error("参数无效：操作");
  return value;
}

export function parseLimit(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const limit = Number(value);
  return Number.isFinite(limit) ? limit : undefined;
}

export function parseArchive(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const archive = Number(value);
  if (!Number.isInteger(archive) || archive < 0)
    throw new Error("参数无效：历史对话");
  return archive;
}
