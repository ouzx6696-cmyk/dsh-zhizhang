/**
 * 设置 schema 与解析（主进程与渲染层共用）。
 * settings.json 只存非机密字段；API Key 由主进程 SecretsService 加密存放在 secrets.bin。
 * 读到未知键或越界值一律报 input.invalid（data.path 指出键路径），不静默删除。
 */
import { AppError } from "@zhizhang/core/errors";
import { arr, bool, int, lit, num, obj, opt, str, type Infer } from "@zhizhang/core/schema";

export const MODEL_ROLES = [
  "writer",
  "editor",
  "planner",
  "judge",
  "extractor",
  "assistant",
] as const;
export type ModelRole = (typeof MODEL_ROLES)[number];

export const MODEL_APIS = [
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai",
] as const;
export type ModelApi = (typeof MODEL_APIS)[number];

export const THINKING_LEVELS = ["off", "low", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

const CONNECTION_SHAPE = {
  id: str({ min: 1, max: 40 }),
  label: str({ min: 1, max: 60 }),
  provider: str({ min: 1, max: 40 }),
  api: lit(...MODEL_APIS),
  baseUrl: str({ min: 1, max: 400 }),
  keyless: bool,
  contextWindow: int({ min: 2048, max: 4_000_000 }),
  maxTokens: int({ min: 16, max: 1_000_000 }),
  price: opt(obj({ inputPer1M: num({ min: 0 }), outputPer1M: num({ min: 0 }) })),
};

const ConnectionSchema = obj(CONNECTION_SHAPE);
export type ModelConnection = Infer<typeof ConnectionSchema>;

export const RoleBindingSchema = obj({
  connection: str({ min: 1 }),
  model: str({ min: 1, max: 200 }),
  thinking: opt(lit(...THINKING_LEVELS)),
  temperature: opt(num({ min: 0, max: 2 })),
});
export type RoleBinding = Infer<typeof RoleBindingSchema>;

const RolesSchema = obj({
  writer: opt(RoleBindingSchema),
  editor: opt(RoleBindingSchema),
  planner: opt(RoleBindingSchema),
  judge: opt(RoleBindingSchema),
  extractor: opt(RoleBindingSchema),
  assistant: opt(RoleBindingSchema),
});
export type RoleBindings = Infer<typeof RolesSchema>;

export const EngineSchema = obj({
  grade: lit("economy", "standard", "premium"),
  inputBudget: int({ min: 1000, max: 200000 }),
  runBudget: int({ min: 10000, max: 10000000 }),
  moneyCap: opt(num({ min: 0 })),
  concurrency: obj({
    global: int({ min: 1, max: 16 }),
    perRun: int({ min: 1, max: 8 }),
  }),
});
export type EngineSettings = Infer<typeof EngineSchema>;

export const AppearanceSchema = obj({
  theme: lit("system", "light", "dark"),
  font: lit("serif", "sans"),
  fontSize: int({ min: 14, max: 26 }),
  measureChars: int({ min: 30, max: 44 }),
  paragraphStyle: lit("indent", "spaced"),
  layout: lit("fluid", "zoom", "off"),
  reducedTransparency: bool,
});
export type AppearanceSettings = Infer<typeof AppearanceSchema>;

export const ContextSchema = obj({
  enabled: bool,
  triggerPercent: int({ min: 50, max: 95 }),
  budget: int({ min: 0, max: 4_000_000 }),
  keepRecentTokens: int({ min: 0, max: 1_000_000 }),
});
export type ContextSettings = Infer<typeof ContextSchema>;

export const SettingsSchema = obj({
  workspaceRoot: opt(str()),
  engine: EngineSchema,
  appearance: AppearanceSchema,
  context: ContextSchema,
  assistant: obj({ preferences: str({ max: 4000 }) }),
  models: obj({
    connections: arr(ConnectionSchema, { max: 20 }),
    roles: RolesSchema,
  }),
});
export type AppSettings = Infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  workspaceRoot: undefined,
  engine: {
    grade: "standard",
    inputBudget: 24000,
    runBudget: 1200000,
    moneyCap: undefined,
    concurrency: { global: 4, perRun: 3 },
  },
  appearance: {
    theme: "light",
    font: "serif",
    fontSize: 17,
    measureChars: 36,
    paragraphStyle: "indent",
    layout: "fluid",
    reducedTransparency: false,
  },
  context: { enabled: true, triggerPercent: 80, budget: 0, keepRecentTokens: 20000 },
  assistant: { preferences: "" },
  models: {
    connections: [],
    roles: {
      writer: undefined,
      editor: undefined,
      planner: undefined,
      judge: undefined,
      extractor: undefined,
      assistant: undefined,
    },
  },
};

export function parseSettings(raw: unknown): AppSettings {
  const parsed = SettingsSchema(raw, "$settings");
  assertUniqueConnections(parsed.models.connections, "$settings.models");
  return parsed;
}

function assertUniqueConnections(connections: readonly { id: string }[], base: string): void {
  const ids = new Set<string>();
  connections.forEach((c, index) => {
    if (ids.has(c.id)) {
      const path = `${base}.connections[${index}].id`;
      throw new AppError("input.invalid", `${path}: duplicate connection id "${c.id}"`, { path });
    }
    ids.add(c.id);
  });
}

export { bindingFor } from "./roles.js";

/** 连接对外视图：不含 API Key，只告诉渲染层是否已配置密钥。 */
export type PublicConnection = ModelConnection & { configured: boolean };
export type PublicSettings = Omit<AppSettings, "models"> & {
  models: { connections: PublicConnection[]; roles: RoleBindings };
  /** 系统密钥库不可用时为 false：密钥只在本次运行内保存在内存。 */
  secretsPersisted: boolean;
};

/** settings.save 接受的分区补丁：每个分区整体替换（模型连接另走 models.save）。 */
export interface SettingsPatch {
  engine?: EngineSettings;
  appearance?: AppearanceSettings;
  context?: ContextSettings;
  assistant?: { preferences: string };
}

export function parseSettingsPatch(raw: unknown): SettingsPatch {
  const parsed = obj({
    engine: opt(EngineSchema),
    appearance: opt(AppearanceSchema),
    context: opt(ContextSchema),
    assistant: opt(obj({ preferences: str({ max: 4000 }) })),
  })(raw, "$patch");
  // obj() 会给缺省的可选分区写出 `key: undefined`；不剔除就会在合并时把现有分区覆盖掉。
  const patch: SettingsPatch = {};
  if (parsed.engine !== undefined) patch.engine = parsed.engine;
  if (parsed.appearance !== undefined) patch.appearance = parsed.appearance;
  if (parsed.context !== undefined) patch.context = parsed.context;
  if (parsed.assistant !== undefined) patch.assistant = parsed.assistant;
  return patch;
}

/** 把分区补丁合并进现有设置：值为 undefined 的分区一律视为“未提供”，保留原值。 */
export function mergeSettingsPatch(current: AppSettings, patch: SettingsPatch): AppSettings {
  return {
    ...current,
    ...(patch.engine !== undefined ? { engine: patch.engine } : {}),
    ...(patch.appearance !== undefined ? { appearance: patch.appearance } : {}),
    ...(patch.context !== undefined ? { context: patch.context } : {}),
    ...(patch.assistant !== undefined ? { assistant: patch.assistant } : {}),
  };
}

/** models.save 的输入：连接列表整体替换；apiKey 省略表示沿用已存密钥，空串表示清除。 */
export const ConnectionInputSchema = obj({ ...CONNECTION_SHAPE, apiKey: opt(str({ max: 400 })) });
export type ConnectionInput = Infer<typeof ConnectionInputSchema>;

export interface ModelsInput {
  connections: ConnectionInput[];
  roles: RoleBindings;
}

export function parseModelsInput(raw: unknown): ModelsInput {
  const parsed = obj({ connections: arr(ConnectionInputSchema, { max: 20 }), roles: RolesSchema })(
    raw,
    "$models",
  );
  assertUniqueConnections(parsed.connections, "$models");
  return parsed;
}
