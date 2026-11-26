/**
 * PI 适配层纯辅助模块（不含任何 @earendil-works/pi-* 导入，遵守 [G-pi] 门禁）。
 */
import { createHash } from "node:crypto";
import type { ModelApi, ThinkingLevel } from "../shared/settings.js";

export interface ResolvedConnection {
  id: string;
  provider: string;
  api: ModelApi;
  baseUrl: string;
  apiKey: string;
  keyless: boolean;
  contextWindow: number;
  maxTokens: number;
}

export interface PiPortOptions {
  authPath: string;
  clock?: { now(): number };
  resolve(connectionId: string): ResolvedConnection;
  /** 发起网络请求前的端点校验钩子（Web 预览模式下用于阻断本机/内网/云元数据地址）。 */
  validateEndpoint?(baseUrl: string): Promise<void>;
  /** 角色绑定上的思考档位与温度（请求未显式指定时回落采用）。 */
  defaults?(
    connectionId: string,
    model: string,
  ): { thinking?: ThinkingLevel; temperature?: number } | undefined;
}

export interface RunParams {
  maxOutput?: number;
  thinking?: ThinkingLevel;
  temperature?: number;
  sessionId?: string;
  cacheRetention?: "none" | "short" | "long";
}

export const ZERO_PI_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

export function providerIdFor(conn: ResolvedConnection, modelId: string): string {
  const sig = createHash("sha256")
    .update(JSON.stringify([conn, modelId]))
    .digest("hex")
    .slice(0, 10);
  return `zhizhang-${conn.id}-${sig}`;
}

export function extractTextParts(content: readonly { type: string; text?: string }[]): string {
  let out = "";
  for (const part of content) {
    if (part.type === "text" && typeof part.text === "string") out += part.text;
  }
  return out;
}

export function extractThinkingParts(
  content: readonly { type: string; thinking?: string }[],
): string {
  const chunks: string[] = [];
  for (const part of content) {
    if (part.type === "thinking" && typeof part.thinking === "string") chunks.push(part.thinking);
  }
  return chunks.join("\n\n").trim();
}

const LOOPBACK = ["localhost", "127.0.0.1", "::1"];
let proxyConfigured = false;

export async function configureSystemProxy(): Promise<void> {
  if (proxyConfigured) return;
  proxyConfigured = true;
  const proxy =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy;
  if (!proxy) return;
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
  const declared = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  const noProxy = [declared, ...LOOPBACK].filter((value) => value.trim()).join(",");
  setGlobalDispatcher(new EnvHttpProxyAgent({ noProxy }));
}

export function reasoningOf(
  level: ThinkingLevel | undefined,
): Exclude<ThinkingLevel, "off"> | undefined {
  return level === undefined || level === "off" ? undefined : level;
}

export function extractStatusCode(message: object, text: string): number | undefined {
  const status: unknown = Reflect.get(message, "status");
  const statusCode: unknown = Reflect.get(message, "statusCode");
  const direct =
    typeof status === "number" ? status : typeof statusCode === "number" ? statusCode : undefined;
  if (direct !== undefined) return direct;
  const matched = /\b(40[123]|429|50[0234])\b/.exec(text)?.[1];
  return matched ? Number(matched) : undefined;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type PiJsonValue =
  string | number | boolean | null | PiJsonValue[] | { [key: string]: PiJsonValue };

export type PiJsonObject = { [key: string]: PiJsonValue };

function toJsonValue(value: unknown): PiJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") return toJsonObject(value);
  return null;
}

export function toJsonObject(value: object): PiJsonObject {
  const out: PiJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = toJsonValue(entry);
  }
  return out;
}
