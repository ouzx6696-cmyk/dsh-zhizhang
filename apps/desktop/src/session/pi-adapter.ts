/**
 * 唯一的 PI SDK 边界：
 *  - ModelPort（流水线阶段调用）：runtime.streamSimple，纯文本单轮；
 *  - AssistantPort（助手会话）：同一 runtime 的 streamSimple，带工具声明的一轮；
 *  - 连接测试与 PI 模型目录。
 * PI 的类型不出本文件；SDK 自带重试一律关闭（maxRetries: 0），由 ModelGateway 统一退避。
 *
 * temperature：PI 1.5 的 streamSimple 经 buildBaseOptions 原样透传 temperature，
 * openai-completions / openai-responses / google / mistral 写入请求体；anthropic-messages
 * 在开启思考或模型声明不支持时丢弃；openai-responses 对推理模型省略。不支持时字段保留但被忽略。
 */
import { createHash } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  getSupportedThinkingLevels,
  InMemoryModelsStore,
  isContextOverflow,
  isRetryableAssistantError,
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
  /** 角色绑定上的思考档位与温度（阶段请求未指定时采用）。 */
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

const PROVIDER_IDS: Record<string, string> = { kimi: "moonshotai-cn" };

interface RuntimeEntry {
  runtime: ModelRuntime;
  model: Model<Api>;
}

const runtimes = new Map<string, Promise<RuntimeEntry>>();
const RUNTIME_LIMIT = 12;

async function buildRuntime(
  conn: ResolvedConnection,
  modelId: string,
  authPath: string,
): Promise<RuntimeEntry> {
  await configureSystemProxy();
  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath: null,
    modelsStore: catalogStore,
    refreshOnCreate: true,
    allowModelNetwork: false,
  });
  const catalog = runtime.getModel(PROVIDER_IDS[conn.provider] ?? conn.provider, modelId);
  const providerId = `zhizhang-${conn.id}`;
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

function runtimeFor(
  conn: ResolvedConnection,
  modelId: string,
  authPath: string,
): Promise<RuntimeEntry> {
  const key = createHash("sha256")
    .update(JSON.stringify([authPath, conn, modelId]))
    .digest("hex");
  const hit = runtimes.get(key);
  if (hit) {
    runtimes.delete(key);
    runtimes.set(key, hit);
    return hit;
  }
  if (runtimes.size >= RUNTIME_LIMIT) {
    const oldest = runtimes.keys().next();
    if (!oldest.done) runtimes.delete(oldest.value);
  }
  const pending = buildRuntime(conn, modelId, authPath);
  runtimes.set(key, pending);
  pending.catch(() => {
    if (runtimes.get(key) === pending) runtimes.delete(key);
  });
  return pending;
}

function reasoningOf(level: ThinkingLevel | undefined): Exclude<ThinkingLevel, "off"> | undefined {
  return level === undefined || level === "off" ? undefined : level;
}

/** 把失败的回答映射成错误码；优先看结构化 HTTP 状态码与 PI 判定，不匹配中文文案。 */
function extractStatusCode(message: AssistantMessage, text: string): number | undefined {
  const raw = message as unknown as Record<string, unknown>;
  const direct =
    typeof raw.status === "number"
      ? raw.status
      : typeof raw.statusCode === "number"
        ? raw.statusCode
        : undefined;
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

function toolCallsOf(message: AssistantMessage): AgentToolCall[] {
  return message.content
    .filter((part): part is ToolCall => part.type === "toolCall")
    .map((part) => ({ id: part.id, name: part.name, args: { ...part.arguments } }));
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
  const out: Message[] = [];
  for (const msg of messages) {
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

export function createPiPorts(options: PiPortOptions): ModelPort & AssistantPort {
  const now = () => options.clock?.now() ?? Date.now();

  async function run(
    connectionId: string,
    modelId: string,
    buildContext: (model: Model<Api>) => Context,
    params: { maxOutput?: number; thinking?: ThinkingLevel; temperature?: number },
    signal: AbortSignal,
    onDelta: (event: AssistantTurnEvent) => void,
  ): Promise<{ message: AssistantMessage; model: Model<Api> }> {
    const conn = options.resolve(connectionId);
    if (!conn.keyless && !conn.apiKey) {
      throw new AppError("model.auth", `连接 ${conn.id} 尚未填写 API Key`, { connection: conn.id });
    }
    const { runtime, model } = await runtimeFor(conn, modelId, options.authPath);
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
      });
      for await (const event of stream) {
        if (event.type === "text_delta") onDelta({ type: "text_delta", delta: event.delta });
        else if (event.type === "toolcall_end")
          onDelta({ type: "tool_call", name: event.toolCall.name });
      }
      const message = await stream.result();
      if (message.stopReason === "error" || message.stopReason === "aborted") {
        throw answerError(message, conn.contextWindow);
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
        { maxOutput: req.maxOutput, thinking: req.thinking, temperature: req.temperature },
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
        { maxOutput: request.maxOutput },
        signal,
        on,
      );
      return {
        text: textOf(message),
        toolCalls: toolCallsOf(message),
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
  modelId: string,
  authPath: string,
): Promise<ModelCatalogView> {
  const { runtime } = await runtimeFor(conn, modelId, authPath);
  const provider = PROVIDER_IDS[conn.provider] ?? conn.provider;
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
