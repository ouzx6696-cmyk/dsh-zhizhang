/**
 * 模型接线：按设置里的连接与角色绑定构造 ModelGateway（端口由 PI 适配器实现），
 * 以及连接测试与模型目录。设置变更后由组合根调用 rebuild 重建网关。
 */
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import {
  createModelGateway,
  type ModelGateway,
  type RoleBinding as GatewayBinding,
} from "@zhizhang/core/model";
import { bindingFor, MODEL_ROLES, type ConnectionInput } from "../shared/settings.js";
import type { ModelCatalogView, ModelTestInput, ModelTestResult } from "../shared/views.js";
import type { ModelCatalogRequest } from "../shared/ipc.js";
import type { AssistantBinding } from "../session/manager.js";
import {
  createPiPorts,
  piModelCatalog,
  testPiConnection,
  type ResolvedConnection,
} from "../session/pi-adapter.js";
import type { AssistantPort } from "../session/types.js";
import type { ConfigService } from "./services/config.js";

const NOT_CONFIGURED = "请先在设置里为写手配置模型连接";

export function resolveConnection(
  config: ConfigService,
  id: string,
  draft?: ConnectionInput,
): ResolvedConnection {
  if (draft) {
    const stored = config.settings().models.connections.some((c) => c.id === draft.id);
    const apiKey = draft.apiKey ?? (stored ? config.apiKey(draft.id) : "");
    return { ...draft, apiKey };
  }
  const conn = config.connection(id);
  return { ...conn, apiKey: config.apiKey(id) };
}

export interface ModelServices {
  gateway(): ModelGateway;
  port(): AssistantPort;
  rebuild(): void;
  assistantBinding(): AssistantBinding;
  test(input: ModelTestInput): Promise<ModelTestResult>;
  catalog(request: ModelCatalogRequest): Promise<ModelCatalogView>;
}

export function createModelServices(deps: {
  config: ConfigService;
  clock: Clock;
  authPath: string;
}): ModelServices {
  const { config } = deps;
  const ports = createPiPorts({
    authPath: deps.authPath,
    clock: deps.clock,
    resolve(id) {
      if (!config.settings().models.connections.some((c) => c.id === id)) {
        throw new AppError("model.auth", NOT_CONFIGURED, { connection: id });
      }
      return resolveConnection(config, id);
    },
    defaults(connection, model) {
      const roles = config.settings().models.roles;
      const hit = MODEL_ROLES.map((role) => roles[role]).find(
        (b) => b !== undefined && b.connection === connection && b.model === model,
      );
      return hit ? { thinking: hit.thinking, temperature: hit.temperature } : undefined;
    },
  });

  function build(): ModelGateway {
    const settings = config.settings();
    const roles: Record<string, GatewayBinding> = {};
    for (const role of MODEL_ROLES) {
      const binding = bindingFor(settings.models.roles, role);
      if (!binding) continue;
      const conn = settings.models.connections.find((c) => c.id === binding.connection);
      roles[role] = {
        connection: binding.connection,
        model: binding.model,
        ...(conn?.price ? { price: conn.price } : {}),
      };
    }
    return createModelGateway(
      ports,
      {
        globalConcurrency: settings.engine.concurrency.global,
        perRunConcurrency: settings.engine.concurrency.perRun,
        roles,
      },
      deps.clock,
    );
  }

  let gateway = build();

  return {
    gateway: () => gateway,
    port: () => ports,
    rebuild() {
      gateway = build();
    },
    assistantBinding() {
      const settings = config.settings();
      const binding = bindingFor(settings.models.roles, "assistant");
      if (!binding) throw new AppError("model.auth", NOT_CONFIGURED, { role: "assistant" });
      const conn = config.connection(binding.connection);
      return {
        connection: binding.connection,
        model: binding.model,
        contextWindow: conn.contextWindow,
        maxTokens: conn.maxTokens,
      };
    },
    async test(input) {
      const conn = resolveConnection(config, input.connectionId, input.draft);
      if (!conn.keyless && !conn.apiKey) {
        throw new AppError("model.auth", "请先填写 API Key", { connection: conn.id });
      }
      return testPiConnection(conn, input.model, deps.authPath, deps.clock);
    },
    async catalog(request) {
      const conn = resolveConnection(config, request.connectionId, request.draft);
      if (request.source === "pi") {
        const model = bindingFor(config.settings().models.roles, "writer")?.model ?? "default";
        return piModelCatalog(conn, model, deps.authPath);
      }
      return endpointCatalog(conn);
    },
  };
}

/** 读取 OpenAI 兼容端点的 /models 列表（仅模型 id；作者主动点“读取端点模型”时才发请求）。 */
async function endpointCatalog(conn: ResolvedConnection): Promise<ModelCatalogView> {
  if (conn.api !== "openai-completions" && conn.api !== "openai-responses") {
    throw new AppError("input.invalid", "该接口类型不支持读取端点模型列表，请手填模型 id", {
      api: conn.api,
    });
  }
  const response = await fetch(`${conn.baseUrl.replace(/\/$/, "")}/models`, {
    headers: conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {},
    signal: AbortSignal.timeout(10000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new AppError("model.auth", `端点拒绝访问（${response.status}）`, {
      status: response.status,
    });
  }
  if (!response.ok) {
    throw new AppError("model.unavailable", `模型列表请求失败（${response.status}）`, {
      status: response.status,
    });
  }
  const body: unknown = await response.json();
  const data = typeof body === "object" && body !== null ? Reflect.get(body, "data") : undefined;
  if (!Array.isArray(data))
    throw new AppError("model.output_invalid", "模型列表响应缺少 data 数组");
  const models = data
    .map((item: unknown) =>
      typeof item === "object" && item !== null ? Reflect.get(item, "id") : undefined,
    )
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => ({ id: value, name: value }));
  return { source: "endpoint", models };
}
