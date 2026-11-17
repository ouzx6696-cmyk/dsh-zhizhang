import { AppError } from "../errors/app-error.js";
import type { Parser } from "./parse.js";

export function parseJson<T>(raw: string, parser?: Parser<T>, source = "json"): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new AppError("storage.format_unsupported", `${source}: invalid JSON`, {
      source,
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  return parser ? parser(parsed, "$") : (parsed as T);
}

/**
 * 递归删除值为 undefined 的对象键，数组与基本值保持不变。
 * 用于 `opt()` 解析后必然写出的 `key: undefined`，保证落盘 JSON 不含该键。
 */
function cleanUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cleanUndefined);
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue;
      out[key] = cleanUndefined(val);
    }
    return out;
  }
  return value;
}

export function dropUndefined<T>(value: T): T {
  return cleanUndefined(value) as T;
}
