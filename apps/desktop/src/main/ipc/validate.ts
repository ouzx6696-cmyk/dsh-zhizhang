import type { Focus, Target } from "../../context";
import type { Appearance } from "../../settings";
import type { RequestOptions } from "./contract";

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
  if (
    typeof value !== "string" ||
    !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value)
  )
    throw new Error("参数无效：操作");
  return value;
}

export function parseRequestOptions(value: unknown): RequestOptions {
  if (value === undefined || value === null) return {};
  const source = asRecord(value, "请求参数");
  const method = source.method === undefined ? undefined : String(source.method).toUpperCase();
  if (method && method !== "GET" && method !== "POST")
    throw new Error("参数无效：请求方法");
  let query: Record<string, unknown> | undefined;
  if (source.query !== undefined) {
    query = asRecord(source.query, "查询参数");
    for (const [key, item] of Object.entries(query))
      if (
        item !== undefined &&
        item !== null &&
        typeof item !== "string" &&
        typeof item !== "number" &&
        typeof item !== "boolean"
      )
        throw new Error(`参数无效：查询参数 ${key}`);
  }
  if (
    source.body !== undefined &&
    (typeof source.body !== "object" || source.body === null || Array.isArray(source.body))
  )
    throw new Error("参数无效：请求内容");
  return { method, query, body: source.body };
}

export function parseAppearance(value: unknown): Partial<Appearance> {
  const source = asRecord(value, "外观");
  const result: Partial<Appearance> = {};
  if (source.theme !== undefined) {
    if (!["system", "light", "dark"].includes(String(source.theme)))
      throw new Error("参数无效：主题");
    result.theme = source.theme as Appearance["theme"];
  }
  if (source.font !== undefined) {
    if (!["serif", "sans"].includes(String(source.font)))
      throw new Error("参数无效：正文字体");
    result.font = source.font as Appearance["font"];
  }
  if (source.fontSize !== undefined) {
    const size = Number(source.fontSize);
    if (!Number.isInteger(size) || size < 14 || size > 28)
      throw new Error("参数无效：正文字号");
    result.fontSize = size;
  }
  return result;
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
