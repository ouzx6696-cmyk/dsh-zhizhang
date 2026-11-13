import { isRecord } from "../../../../../packages/core/src/parse";
import { FONT_SIZE } from "../../appearance";
import type { Focus, Target } from "../../context";
import type { Appearance } from "../../appearance";
import type { RequestOptions } from "./contract";

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`参数无效：${label}应为对象`);
  return value;
}

export function parseMode(value: unknown): Target["mode"] {
  if (value !== "fanqie" && value !== "toutiao") throw new Error("未知模式");
  return value;
}

export function parseTarget(value: unknown): Target {
  const source = asRecord(value, "作品目标");
  if (typeof source.root !== "string" || !source.root.trim()) throw new Error("参数无效：作品目录");
  return {
    mode: parseMode(source.mode),
    root: source.root,
    ...(typeof source.article === "string" && source.article ? { article: source.article } : {}),
    ...(typeof source.work === "string" && source.work ? { work: source.work } : {}),
  };
}

export function parseFocus(value: unknown): Focus {
  if (value === undefined || value === null) return {};
  const source = asRecord(value, "任务对象");
  const focus: Focus = {};
  for (const key of ["article", "chapter", "candidate", "title", "workTitle"] as const) {
    if (source[key] === undefined) continue;
    if (typeof source[key] !== "string") throw new Error(`参数无效：任务对象 ${key}`);
    focus[key] = source[key];
  }
  if (source.revision !== undefined) {
    if (
      typeof source.revision !== "string" &&
      !(typeof source.revision === "number" && Number.isFinite(source.revision))
    )
      throw new Error("参数无效：正文版本");
    focus.revision = source.revision;
  }
  if (source.dirty !== undefined) {
    if (typeof source.dirty !== "boolean") throw new Error("参数无效：未保存状态");
    focus.dirty = source.dirty;
  }
  if (source.source !== undefined) {
    if (
      typeof source.source !== "string" ||
      !["chapter", "candidate", "article", "split"].includes(source.source)
    )
      throw new Error("参数无效：正文来源");
    focus.source = source.source as Focus["source"];
  }
  if (source.intent !== undefined) {
    if (
      typeof source.intent !== "string" ||
      !["write", "review", "plan", "inspect", "revise"].includes(source.intent)
    )
      throw new Error("参数无效：任务意图");
    focus.intent = source.intent as Focus["intent"];
  }
  return focus;
}

export function parseText(value: unknown): string {
  if (typeof value !== "string") throw new Error("参数无效：文本");
  return value;
}

export function parseOperation(value: unknown): string {
  if (typeof value !== "string" || !/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(value))
    throw new Error("参数无效：操作");
  return value;
}

export function parseRequestOptions(value: unknown): RequestOptions {
  if (value === undefined || value === null) return {};
  const source = asRecord(value, "请求参数");
  if (source.kind !== undefined && source.kind !== "read" && source.kind !== "write")
    throw new Error("参数无效：操作类型");
  const input = source.input === undefined ? undefined : asRecord(source.input, "操作内容");
  return { kind: source.kind, input };
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
    if (!["serif", "sans"].includes(String(source.font))) throw new Error("参数无效：正文字体");
    result.font = source.font as Appearance["font"];
  }
  if (source.reducedTransparency !== undefined) {
    if (typeof source.reducedTransparency !== "boolean") throw new Error("参数无效：透明效果");
    result.reducedTransparency = source.reducedTransparency;
  }
  if (source.layout !== undefined) {
    if (!["fluid", "zoom", "off"].includes(String(source.layout)))
      throw new Error("参数无效：大窗口布局");
    result.layout = source.layout as Appearance["layout"];
  }
  if (source.fontSize !== undefined) {
    const size = source.fontSize;
    if (
      typeof size !== "number" ||
      !Number.isInteger(size) ||
      size < FONT_SIZE.min ||
      size > FONT_SIZE.max
    )
      throw new Error("参数无效：正文字号");
    result.fontSize = size;
  }
  return result;
}

import { DEFAULT_HISTORY_LIMIT } from "../../history-options";
export function parseLimit(value: unknown): number {
  if (value === undefined) return DEFAULT_HISTORY_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 10000)
    throw new Error("参数无效：历史条数");
  return value;
}

export function parseArchive(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const archive = value;
  if (typeof archive !== "number" || !Number.isInteger(archive) || archive < 0)
    throw new Error("参数无效：历史对话");
  return archive;
}

export function parseChoice<const T extends readonly string[]>(
  value: unknown,
  choices: T,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value))
    throw new Error("参数无效：" + String(value));
  return value;
}
export function parseRecovery(value: unknown) {
  const row = asRecord(value, "恢复条件");
  return { id: parseText(row.id), fingerprint: parseText(row.fingerprint) };
}
export function parseExternal(value: unknown) {
  const url = new URL(parseText(value));
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("只支持公开网页链接");
  return url.href;
}
