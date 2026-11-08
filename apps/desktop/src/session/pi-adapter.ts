/** The only Pi SDK import boundary, including its accepted-prompt hook. */
export {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
export type { AgentSession, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ModelRuntime, type AgentSession } from "@earendil-works/pi-coding-agent";
export type { Api, ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
  getSupportedThinkingLevels,
  clampThinkingLevel,
  InMemoryModelsStore,
} from "@earendil-works/pi-ai";
export { getSupportedThinkingLevels, clampThinkingLevel };
const catalogStore = new InMemoryModelsStore();
let proxyConfigured = false;
const LOOPBACK = ["localhost", "127.0.0.1", "::1"];
async function configureSystemProxy() {
  if (proxyConfigured) return;
  if (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  ) {
    const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("undici");
    // Local model servers (Ollama, LM Studio, relays) are never sent through a system proxy,
    // even when the author's NO_PROXY does not list loopback.
    const declared = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
    const noProxy = [declared, ...LOOPBACK].filter((value) => value.trim()).join(",");
    setGlobalDispatcher(new EnvHttpProxyAgent({ noProxy }));
  }
  proxyConfigured = true;
}
import type { ModelConnection } from "../models";
import { asRecord } from "../main/ipc/validate.js";
/** Keep cancellation attached through context preparation and SDK prompt startup. */
export async function promptWithSignal(
  session: AgentSession,
  prepare: () => Promise<string>,
  signal?: AbortSignal,
) {
  const abort = () => {
    void session.abort();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const text = await prepare();
    signal?.throwIfAborted();
    await session.prompt(text, {
      expandPromptTemplates: false,
      // prompt awaits input/auth before marking a run active. Reapply an abort
      // received in that gap once the run exists, before its first request.
      preflightResult: () => {
        if (signal?.aborted) abort();
      },
    });
    signal?.throwIfAborted();
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
const PROVIDER_IDS: Record<string, string> = { kimi: "moonshotai-cn" };
const providerId = (id: string) => PROVIDER_IDS[id] ?? id;
export async function runtimeModel(settings: ModelConnection, authPath: string, role: string) {
  await configureSystemProxy();
  const runtime = await ModelRuntime.create({
    authPath,
    modelsPath: null,
    modelsStore: catalogStore,
    refreshOnCreate: true,
    allowModelNetwork: false,
  });
  const catalog = runtime.getModel(providerId(settings.provider), settings.model);
  runtime.registerProvider("writer-" + role, {
    baseUrl: settings.baseUrl,
    apiKey: settings.keyless ? "local" : settings.apiKey,
    api: settings.api,
    models: [
      {
        ...catalog,
        ...(settings.thinkingLevelMap ? { thinkingLevelMap: settings.thinkingLevelMap } : {}),
        baseUrl: settings.baseUrl,
        api: settings.api,
        id: settings.model,
        name: settings.model,
        reasoning: settings.reasoning,
        input: ["text"],
        cost: catalog?.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: settings.contextWindow,
        maxTokens: settings.maxTokens,
      },
    ],
  });
  const model = runtime.getModel("writer-" + role, settings.model);
  if (!model) throw new Error("模型配置未生效");
  return { runtime, model };
}
export async function promptAccepted(
  session: AgentSession,
  text: string,
  onError: (error: unknown) => void,
) {
  await new Promise<void>((resolve, reject) => {
    let accepted = false;
    void session
      .prompt(text, {
        streamingBehavior: "followUp",
        expandPromptTemplates: false,
        preflightResult: () => {
          accepted = true;
          resolve();
        },
      })
      .then(
        () => resolve(),
        (error) => (accepted ? onError(error) : reject(error)),
      );
  });
}
export async function testConnection(settings: ModelConnection, authPath: string) {
  if (!settings.apiKey && !settings.keyless) throw new Error("请先填写 API Key");
  const start = Date.now(),
    { runtime, model } = await runtimeModel(settings, authPath, "connection");
  const answer = await runtime.completeSimple(
    model,
    {
      messages: [{ role: "user", content: "请只回答 OK", timestamp: Date.now() }],
    },
    { maxTokens: 32 },
  );
  if (answer.stopReason === "error") throw new Error(answer.errorMessage || "模型连接失败");
  return { latency: Date.now() - start, model: settings.model };
}

export async function modelCatalog(authPath: string, settings: ModelConnection, refresh = false) {
  const { runtime, model } = await runtimeModel(settings, authPath, "catalog");
  const provider = providerId(settings.provider);
  if (refresh) {
    const result = await runtime.refresh({
      providers: [provider],
      signal: AbortSignal.timeout(10000),
    });
    const failure = result.errors.get(provider);
    if (failure) throw failure;
  }
  return {
    providers: runtime
      .getProviders()
      .map((p) => {
        const m = runtime.getModels(p.id)[0];
        return m
          ? {
              id: p.id,
              name: p.name,
              api: m.api,
              baseUrl: m.baseUrl,
              model: m.id,
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens,
              reasoning: m.reasoning,
              thinkingLevelMap: m.thinkingLevelMap,
            }
          : null;
      })
      .filter((value): value is NonNullable<typeof value> => value !== null),
    source: "PI 模型目录",
    models: runtime.getModels(provider).map((m) => ({
      id: m.id,
      name: m.name,
      api: m.api,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      thinkingLevelMap: m.thinkingLevelMap,
      levels: getSupportedThinkingLevels(m),
    })),
    levels: getSupportedThinkingLevels(model),
    thinkingLevel: clampThinkingLevel(model, settings.thinkingLevel),
  };
}

export async function discoverModels(settings: ModelConnection) {
  if (settings.api !== "openai-completions" && settings.api !== "openai-responses")
    throw new Error("此自定义接口请使用 PI 目录或手填模型 ID");
  const response = await fetch(settings.baseUrl + "/models", {
    headers: settings.apiKey ? { Authorization: "Bearer " + settings.apiKey } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`模型列表请求失败（${response.status}），可保留配置并手填模型`);
  const body = asRecord(await response.json(), "模型列表响应");
  if (!Array.isArray(body["data"]))
    throw new Error("模型列表响应格式异常：data 应为列表，可保留配置并手填模型");
  return {
    source: "当前端点（仅模型 ID，容量与思考能力需确认）",
    models: body["data"].map((m) => {
      const item = asRecord(m, "模型条目");
      const id = item["id"];
      if (typeof id !== "string" || !id)
        throw new Error("模型列表响应格式异常：模型条目缺字符串 id");
      return { id, name: id };
    }),
  };
}
