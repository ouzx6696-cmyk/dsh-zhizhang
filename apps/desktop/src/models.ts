import type { Api, ModelThinkingLevel } from "./session/pi-adapter";
export type Thinking = ModelThinkingLevel;
export const APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
export type ModelConnection = {
  provider: string;
  api: Api;
  keyless?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
  thinkingLevel: Thinking;
};
export type ModelSettings = {
  writer: ModelConnection;
  editor: ModelConnection;
  planner: ModelConnection | null;
};
export const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    contextWindow: 128000,
    api: "openai-completions",
  },
  {
    id: "kimi",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.5",
    contextWindow: 256000,
    api: "openai-completions",
  },
  {
    id: "qwen",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    contextWindow: 128000,
    api: "openai-completions",
  },
  {
    id: "glm",
    name: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5",
    contextWindow: 128000,
    api: "openai-completions",
  },
  {
    id: "openai",
    name: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
    contextWindow: 128000,
    api: "openai-completions",
  },
  {
    id: "anthropic",
    name: "Anthropic 兼容",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    contextWindow: 200000,
    api: "anthropic-messages",
  },
] as const;
export function defaultModels(): ModelSettings {
  const writer: ModelConnection = {
    ...PROVIDERS[0],
    provider: "deepseek",
    apiKey: "",
    maxTokens: 8192,
    reasoning: false,
    thinkingLevel: "off",
  };
  return {
    writer,
    editor: {
      ...writer,
      model: "deepseek-reasoner",
      reasoning: true,
      thinkingLevel: "medium",
    },
    planner: null,
  };
}
export function connection(next: any, previous: ModelConnection): ModelConnection {
  const url = new URL(String(next.baseUrl || previous.baseUrl));
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("模型接口须为 HTTP(S) 地址");
  const baseUrl = url.href.replace(/\/$/, "");
  const result: ModelConnection = {
    provider: String(next.provider || previous.provider),
    keyless: next.keyless ?? previous.keyless ?? false,
    thinkingLevelMap: next.thinkingLevelMap ?? previous.thinkingLevelMap,
    api: next.api || previous.api,
    baseUrl,
    model: String(next.model || previous.model).trim(),
    apiKey: String(next.apiKey || (baseUrl === previous.baseUrl ? previous.apiKey : "")),
    contextWindow: Number(next.contextWindow ?? previous.contextWindow),
    maxTokens: Number(next.maxTokens ?? previous.maxTokens),
    reasoning: next.reasoning ?? previous.reasoning,
    thinkingLevel: next.thinkingLevel || previous.thinkingLevel,
  };
  if (!result.model) throw new Error("请填写模型 ID");
  if (
    ![
      ...APIS,
      "mistral-conversations",
      "azure-openai-responses",
      "google-vertex",
      "bedrock-converse-stream",
      "openai-codex-responses",
      "pi-messages",
    ].includes(result.api)
  )
    throw new Error("不支持的模型接口类型");
  if (
    !Number.isInteger(result.maxTokens) ||
    result.maxTokens <= 0 ||
    !Number.isInteger(result.contextWindow) ||
    result.contextWindow < result.maxTokens
  )
    throw new Error("上下文窗口须不小于最大输出，且均为正整数");
  if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(result.thinkingLevel))
    throw new Error("不支持的思考档位");
  return result;
}
export function normalizeModels(next: any, previous = defaultModels()): ModelSettings {
  const source = next.writer ? next : { writer: next };
  const writer = connection(source.writer || previous.writer, previous.writer);
  const editor = connection(source.editor || previous.editor, previous.editor);
  if (!editor.apiKey && editor.baseUrl === writer.baseUrl) editor.apiKey = writer.apiKey;
  const planner = source.planner ? connection(source.planner, previous.planner || writer) : null;
  if (planner && !planner.apiKey && planner.baseUrl === writer.baseUrl)
    planner.apiKey = writer.apiKey;
  return { writer, editor, planner };
}
export function publicModels(settings: ModelSettings) {
  return Object.fromEntries(
    Object.entries(settings).map(([role, value]) => [
      role,
      value ? { ...value, apiKey: "", configured: !!value.apiKey || !!value.keyless } : null,
    ]),
  );
}
