import { NovelError } from "./errors.js";
export function asObject(value: unknown, label = "参数"): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new NovelError("bad_args", `${label}必须是对象`);
  return value as Record<string, unknown>;
}
type StringOptions = { required?: boolean; trim?: boolean };
export function asString(
  args: Record<string, unknown>,
  key: string,
  opts: StringOptions & { required: true },
): string;
export function asString(
  args: Record<string, unknown>,
  key: string,
  opts?: StringOptions,
): string | undefined;
export function asString(
  args: Record<string, unknown>,
  key: string,
  opts: StringOptions = {},
): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (opts.required) throw new NovelError("bad_args", `参数 ${key} 必填`);
    return undefined;
  }
  if (typeof value !== "string") throw new NovelError("bad_args", `参数 ${key} 必须是字符串`);
  const result = opts.trim === false ? value : value.trim();
  if (opts.required && opts.trim !== false && !result)
    throw new NovelError("bad_args", `参数 ${key} 不能为空`);
  return result;
}
export function boolArg(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new NovelError("bad_args", `参数 ${key} 必须是布尔值`);
  return value;
}
export function asStringArray(
  args: Record<string, unknown>,
  key: string,
  opts: { required?: boolean } = {},
): string[] | undefined {
  const value = args[key];
  if (value === undefined) {
    if (opts.required) throw new NovelError("bad_args", `参数 ${key} 必填`);
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item: unknown) => typeof item === "string"))
    throw new NovelError("bad_args", `参数 ${key} 必须是字符串数组`);
  return value.map((item) => item.trim()).filter(Boolean);
}

export function asEnum<T extends readonly string[]>(
  args: Record<string, unknown>,
  key: string,
  values: T,
): T[number] | undefined {
  const value = asString(args, key);
  if (value === undefined) return undefined;
  if (!values.includes(value)) throw new NovelError("bad_args", `非法 ${key}：${value}`);
  return value as T[number];
}
