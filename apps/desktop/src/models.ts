/**
 * 模型连接的预设与类型（渲染层设置页使用）。连接与角色绑定的 schema 在 shared/settings.ts，
 * API Key 只经 models.save 写入主进程密钥库，不回传渲染层。
 */
import { MODEL_APIS, type ModelConnection, type ThinkingLevel } from "./shared/settings.js";

export type { ModelConnection };
export type Thinking = ThinkingLevel;
export const APIS = MODEL_APIS;

/** 常见服务商预设：新建连接时据此填充默认字段，作者可改。 */
export const PROVIDERS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-chat",
    contextWindow: 128000,
    maxTokens: 8192,
    api: "openai-completions",
  },
  {
    id: "kimi",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k2.5",
    contextWindow: 256000,
    maxTokens: 8192,
    api: "openai-completions",
  },
  {
    id: "qwen",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    contextWindow: 128000,
    maxTokens: 8192,
    api: "openai-completions",
  },
  {
    id: "glm",
    name: "智谱",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5",
    contextWindow: 128000,
    maxTokens: 8192,
    api: "openai-completions",
  },
  {
    id: "openai",
    name: "OpenAI 兼容",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1",
    contextWindow: 128000,
    maxTokens: 8192,
    api: "openai-completions",
  },
  {
    id: "anthropic",
    name: "Anthropic 兼容",
    baseUrl: "https://api.anthropic.com",
    model: "claude-sonnet-4-5",
    contextWindow: 200000,
    maxTokens: 8192,
    api: "anthropic-messages",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
  api: (typeof MODEL_APIS)[number];
}>;
