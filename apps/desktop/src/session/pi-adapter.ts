/**
 * 唯一的 PI SDK 边界：
 *  - ModelPort（流水线阶段调用）：共享 ModelRuntime 的 streamSimple，支持会话亲和与 Prompt Caching；
 *  - AssistantPort（助手会话）：流式输出正文 + 思考链，并经 validateToolArguments 纠偏工具参数；
 *  - 连接测试、PI 内置模型目录与配置变更后的运行时缓存失效。
 * PI 的类型不出本文件；SDK 自带重试一律关闭（maxRetries: 0），由 ModelGateway / SessionManager 统一退避。
 */
import { createHash } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  InMemoryModelsStore,
  isContextOverflow,
  isRecoverableLength,
  isRetryableAssistantError,
  validateToolArguments,
  type Api,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type Tool,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { AppError, classify } from "@zhizhang/core/errors";
import type { ModelAnswer, ModelPort, ModelRequest, StreamEvent } from "@zhizhang/core/model";
import type { ModelApi, ThinkingLevel } from "../shared/settings.js";
import type { ModelCatalogView, ModelTestResult } from "../shared/views.js";
import { repairOrphanedToolCalls, resolvePiProviderId } from "./transcript.js";
import type {
  AgentMessage,
  AgentToolCall,
  AssistantPort,
  AssistantTurnAnswer,
  AssistantTurnEvent,
  AssistantTurnRequest,
} from "./types.js";

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
  /** 角色绑定上的思考档位与温度（请求未显式指定时回落采用）。 */
  defaults?(
    connectionId: string,
    model: string,
  ): { thinking?: ThinkingLevel; temperature?: number } | undefined;
}

const catalogStore = new InMemoryModelsStore();
const LOOPBACK = ["localhost", "127.0.0.1", "::1"];
let proxyConfigured = false;

async function configureSystemProxy(): Promise<void> {
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

const runtimesByAuth = new Map<string, Promise<ModelRuntime>>();

/** 配置变更或密钥轮换后主动失效共享的 PI ModelRuntime，确保新参数立即生效。 */
export function invalidatePiRuntime(authPath?: string): void {
  if (authPath) runtimesByAuth.delete(authPath);
  else runtimesByAuth.clear();
}

function getRuntime(authPath: string): Promise<ModelRuntime> {
  const hit = runtimesByAuth.get(authPath);
  if (hit) return hit;
  const pending = (async () => {
    await configureSystemProxy();
    return ModelRuntime.create({
      authPath,
      modelsPath: null,
      modelsStore: catalogStore,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
  })();
  runtimesByAuth.set(authPath, pending);
  pending.catch(() => {
    if (runtimesByAuth.get(authPath) === pending) runtimesByAuth.delete(authPath);
  });
  return pending;
}

async function resolveRuntimeModel(
  conn: ResolvedConnection,
  modelId: string,
  authPath: string,
): Promise<{ runtime: ModelRuntime; model: Model<Api> }> {
  const runtime = await getRuntime(authPath);
  const sig = createHash("sha256")
    .update(JSON.stringify([conn, modelId]))
    .digest("hex")
    .slice(0, 10);
  const providerId = `zhizhang-${conn.id}-${sig}`;
  const existing = runtime.getModel(providerId, modelId);
  if (existing) return { runtime, model: existing };
  const catalog = runtime.getModel(resolvePiProviderId(conn.provider), modelId);
  runtime.registerProvider(providerId, {
    baseUrl: conn.baseUrl,
    apiKey: conn.keyless ? "local" : conn.apiKey,
    api: conn.api,
    models: [
      {
        ...catalog,
        id: modelId,
        name: modelId,
        api: conn.api,
        baseUrl: conn.baseUrl,
        reasoning: catalog?.reasoning ?? false,
        input: ["text"],
        cost: catalog?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: conn.contextWindow,
        maxTokens: conn.maxTokens,
      },
    ],
  });
  const model = runtime.getModel(providerId, modelId);
  if (!model)
    throw new AppError("model.unavailable", `模型配置未生效：${modelId}`, { model: modelId });
  return { runtime, model };
}

function reasoningOf(level: ThinkingLevel | undefined): Exclude<ThinkingLevel, "off"> | undefined {
  return level === undefined || level === "off" ? undefined : level;
}

/** 把失败的回答映射成错误码；优先看结构化 HTTP 状态码与 PI 判定，不匹配中文文案。 */
function extractStatusCode(message: AssistantMessage, text: string): number | undefined {
  const status: unknown = Reflect.get(message, "status");
  const statusCode: unknown = Reflect.get(message, "statusCode");
  const direct =
    typeof status === "number" ? status : typeof statusCode === "number" ? statusCode : undefined;
  if (direct !== undefined) return direct;
  const matched = /\b(40[123]|429|50[0234])\b/.exec(text)?.[1];
  return matched ? Number(matched) : undefined;
}

function answerError(message: AssistantMessage, contextWindow: number): AppError {
  const text = message.errorMessage ?? "";
  if (message.stopReason === "aborted") return new AppError("run.stopped", "模型请求已取消");
  if (isContextOverflow(message, contextWindow)) {
    return new AppError("model.context_overflow", text || "上下文超出模型窗口");
  }
  const status = extractStatusCode(message, text);
  if (status === 401 || status === 403) return new AppError("model.auth", text, { status });
  if (status === 402) return new AppError("model.balance", text, { status: 402 });
  if (status === 429) return new AppError("model.rate_limited", text, { status: 429 });
  if (isRetryableAssistantError(message)) return new AppError("model.unavailable", text);
  return new AppError("model.unavailable", text || "模型请求失败");
}

function usageOf(message: AssistantMessage): ModelAnswer["usage"] {
  return {
    input: message.usage.input,
    cachedInput: message.usage.cacheRead,
    output: message.usage.output,
  };
}

function costOf(message: AssistantMessage, model: Model<Api>): number | null {
  const priced = model.cost.input > 0 || model.cost.output > 0;
  return priced ? message.usage.cost.total : null;
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function thinkingOf(message: AssistantMessage): string {
  return message.content
    .filter((part): part is { type: "thinking"; thinking: string } => part.type === "thinking")
    .map((part) => part.thinking)
    .join("\n\n")
    .trim();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toolCallsOf(message: AssistantMessage, tools: readonly Tool[]): AgentToolCall[] {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  return message.content
    .filter((part): part is ToolCall => part.type === "toolCall")
    .map((part) => {
      const def = byName.get(part.name);
      if (def) {
        try {
          const coerced: unknown = validateToolArguments(def, part);
          if (isPlainRecord(coerced)) return { id: part.id, name: part.name, args: coerced };
        } catch {
          // 留给 executeTool 返回结构化参数错误，不中断当前轮次
        }
      }
      return { id: part.id, name: part.name, args: { ...part.arguments } };
    });
}

function isPiAssistant(value: unknown): value is AssistantMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "role" in value &&
    value.role === "assistant" &&
    "content" in value &&
    Array.isArray(value.content)
  );
}

type PiJsonValue =
  string | number | boolean | null | PiJsonValue[] | { [key: string]: PiJsonValue };
type PiJsonObject = { [key: string]: PiJsonValue };

function toJsonValue(value: unknown): PiJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") return toJsonObject(value);
  return null;
}

function toJsonObject(value: object): PiJsonObject {
  const out: PiJsonObject = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = toJsonValue(entry);
  }
  return out;
}

function toPiMessages(
  messages: AgentMessage[],
  request: AssistantTurnRequest,
  model: Model<Api>,
): Message[] {
  const repaired = repairOrphanedToolCalls(messages);
  const out: Message[] = [];
  for (const msg of repaired) {
    if (msg.role === "user") {
      out.push({ role: "user", content: msg.text, timestamp: msg.at });
    } else if (msg.role === "summary") {
      out.push({ role: "user", content: `【此前对话摘要】\n${msg.text}`, timestamp: msg.at });
    } else if (msg.role === "tool") {
      out.push({
        role: "toolResult",
        toolCallId: msg.callId,
        toolName: msg.name,
        content: [{ type: "text", text: msg.text }],
        isError: msg.isError,
        timestamp: msg.at,
      });
    } else {
      const sameOrigin =
        msg.origin?.connection === request.connection && msg.origin.model === request.model;
      if (sameOrigin && isPiAssistant(msg.raw)) {
        out.push(msg.raw);
        continue;
      }
      out.push({
        role: "assistant",
        content: [
          ...(msg.text ? [{ type: "text" as const, text: msg.text }] : []),
          ...msg.toolCalls.map((call): ToolCall => ({
            type: "toolCall",
            id: call.id,
            name: call.name,
            arguments: toJsonObject(call.args),
          })),
        ],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: msg.toolCalls.length > 0 ? "toolUse" : "stop",
        timestamp: msg.at,
      });
    }
  }
  return out;
}

interface RunParams {
  maxOutput?: number;
  thinking?: ThinkingLevel;
  temperature?: number;
  sessionId?: string;
  cacheRetention?: "none" | "short" | "long";
}

export function createPiPorts(options: PiPortOptions): ModelPort & AssistantPort {
  const now = () => options.clock?.now() ?? Date.now();

  async function run(
    connectionId: string,
    modelId: string,
    buildContext: (model: Model<Api>) => Context,
    params: RunParams,
    signal: AbortSignal,
    onDelta: (event: AssistantTurnEvent) => void,
  ): Promise<{ message: AssistantMessage; model: Model<Api> }> {
    const conn = options.resolve(connectionId);
    if (!conn.keyless && !conn.apiKey) {
      throw new AppError("model.auth", `连接 ${conn.id} 尚未填写 API Key`, { connection: conn.id });
    }
    const { runtime, model } = await resolveRuntimeModel(conn, modelId, options.authPath);
    const context = buildContext(model);
    const preset = options.defaults?.(connectionId, modelId);
    const temperature = params.temperature ?? preset?.temperature;
    const reasoning = reasoningOf(params.thinking ?? preset?.thinking);
    try {
      const stream = runtime.streamSimple(model, context, {
        signal,
        maxRetries: 0,
        ...(params.maxOutput ? { maxTokens: params.maxOutput } : {}),
        ...(temperature !== undefined ? { temperature } : {}),
        ...(reasoning ? { reasoning } : {}),
        ...(params.sessionId ? { sessionId: params.sessionId } : {}),
        ...(params.cacheRetention ? { cacheRetention: params.cacheRetention } : {}),
      });
      for await (const event of stream) {
        if (event.type === "text_delta") onDelta({ type: "text_delta", delta: event.delta });
        else if (event.type === "thinking_delta")
          onDelta({ type: "thinking_delta", delta: event.delta });
        else if (event.type === "toolcall_end")
          onDelta({ type: "tool_call", name: event.toolCall.name });
      }
      const message = await stream.result();
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw answerError(message, conn.contextWindow);
      }
      if (isContextOverflow(message, conn.contextWindow)) {
        throw new AppError("model.context_overflow", message.errorMessage || "上下文超出模型窗口");
      }
      if (
        message.stopReason === "length" &&
        isRecoverableLength(message, params.maxOutput ?? conn.maxTokens)
      ) {
        throw new AppError("model.context_overflow", "输出受上下文长度截断，需压缩上下文后重试");
      }
      return { message, model };
    } catch (err) {
      if (signal.aborted) throw new AppError("run.stopped", "模型请求已取消");
      throw classify(err, { provider: true });
    }
  }

  return {
    async stream(
      req: ModelRequest,
      signal: AbortSignal,
      on: (e: StreamEvent) => void,
    ): Promise<ModelAnswer> {
      const { message, model } = await run(
        req.connection,
        req.model,
        () => ({
          systemPrompt: req.system,
          messages: [{ role: "user", content: req.user, timestamp: now() }],
        }),
        {
          maxOutput: req.maxOutput,
          thinking: req.thinking,
          temperature: req.temperature,
          sessionId: req.sessionId,
          cacheRetention: req.cacheRetention,
        },
        signal,
        (event) => {
          if (event.type === "text_delta") on({ type: "delta", text: event.delta });
        },
      );
      on({ type: "done" });
      return { text: textOf(message), usage: usageOf(message), cost: costOf(message, model) };
    },

    async turn(request, signal, on): Promise<AssistantTurnAnswer> {
      const tools: Tool[] = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }));
      const { message, model } = await run(
        request.connection,
        request.model,
        (resolvedModel) => ({
          systemPrompt: request.system,
          messages: toPiMessages(request.messages, request, resolvedModel),
          tools,
        }),
        {
          maxOutput: request.maxOutput,
          thinking: request.thinking,
          temperature: request.temperature,
          sessionId: request.sessionId,
          cacheRetention: request.cacheRetention,
        },
        signal,
        on,
      );
      const thinking = thinkingOf(message);
      return {
        text: textOf(message),
        ...(thinking ? { thinking } : {}),
        toolCalls: toolCallsOf(message, tools),
        usage: usageOf(message),
        cost: costOf(message, model),
        raw: message,
      };
    },
  };
}

const TEST_CONNECTION_TIMEOUT_MS = 15_000;

export async function testPiConnection(
  conn: ResolvedConnection,
  modelId: string,
  authPath: string,
  clock: { now(): number },
): Promise<ModelTestResult> {
  const ports = createPiPorts({ authPath, clock, resolve: () => conn });
  const started = clock.now();
  const timeoutSignal = AbortSignal.timeout(TEST_CONNECTION_TIMEOUT_MS);
  try {
    await ports.stream(
      { connection: conn.id, model: modelId, system: "", user: "请只回答 OK", maxOutput: 32 },
      timeoutSignal,
      () => undefined,
    );
  } catch (err) {
    if (timeoutSignal.aborted) {
      throw new AppError("network.proxy", "模型连接测试超时（15 秒），请检查网络或接口地址");
    }
    throw err;
  }
  return { latencyMs: clock.now() - started, model: modelId };
}

export async function piModelCatalog(
  conn: ResolvedConnection,
  _modelId: string,
  authPath: string,
): Promise<ModelCatalogView> {
  const runtime = await getRuntime(authPath);
  const provider = resolvePiProviderId(conn.provider);
  return {
    source: "pi",
    models: runtime.getModels(provider).map((m) => ({
      id: m.id,
      name: m.name,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning && getSupportedThinkingLevels(m).length > 1,
    })),
  };
}
