/**
 * dsh-zhizhang — DeepSeek Harness plugin entry (on-demand).
 *
 * The profile mount registers exactly one trigger tool (`zhizhang_enable`) plus the
 * read-only Web panel HTTP routes. The 46 织章 tools and the resident hard-rules
 * prompt section are mounted only after the trigger is called, on the calling
 * Agent scope when the host exposes one — standard sessions stay clean.
 */
import { formatToolError } from "./lib/errors.js";
import { registerPanelHttpRoutes } from "./lib/http-api.js";
import { applyTools, type MountContext } from "./lib/bootstrap.js";
import {
  AcceptPolicy,
  BriefGate,
  InspirationPort,
  LibraryPort,
  LintGate,
  METHOD_ASSET_IDS,
  MethodRegistry,
  MultiDraftPort,
  HumanFeelAuditorPort,
  HumanFeelGate,
  NovelSenseAuditorPort,
  NovelSenseGate,
  PayoffAuditorPort,
  ProductMap,
  Scheduler,
  SaveBypassGate,
  StyleLinterPort,
  setPortConfig,
  envMultiDraftFlag,
} from "./lib/ports/index.js";
import {
  SYSTEM_BRIEF,
  allTools,
  formatLint,
  setPluginConfig,
  type PluginConfig,
  type ToolDef,
} from "./tools/index.js";

export const name = "zhizhang";
export const inject = ["tools"];

const tools: ToolDef[] = allTools();

const ENABLED_RECEIPT = [
  "已启用织章（46 个工具 + 硬规则，仅本会话）。",
  "- 写作段：chapter_brief(lean) → candidate_stage → style_lint →（可选 edit）→ candidate_accept",
  "- 未启用前不注入这些工具与系统提示；换会话需重新调用 zhizhang_enable。",
].join("\n");

function enabledReceipt(): string {
  // Include the map once so the next model step can start even before the new
  // scoped tool schemas are visible in the request.
  return [ENABLED_RECEIPT, "", ProductMap.formatForAgent()].join("\n");
}

const loadedAgents = new WeakSet<object>();

function makeEnableTool(pluginConfig: PluginConfig): ToolDef {
  return {
    name: "zhizhang_enable",
    description:
      "【按需启用】把织章小说工具（46 个）与硬规则加载到当前会话。只有需要拆书 / 写小说 / 改稿时才调用；未调用前这些工具与系统提示都不会注入。启用后调用 zhizhang_product_map 看默认链。",
    parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    async execute(_args, exec) {
      try {
        const agentCtx = (exec as { agent?: { ctx?: MountContext } } | undefined)?.agent?.ctx;
        if (!agentCtx || typeof agentCtx.tools?.register !== "function") {
          return "错误[no_agent_ctx]：当前调用没有可用的 Agent 作用域，无法按会话启用织章；请在新会话重试。";
        }
        if (loadedAgents.has(agentCtx as object)) return enabledReceipt();
        applyTools(agentCtx, pluginConfig);
        loadedAgents.add(agentCtx as object);
        return enabledReceipt();
      } catch (err) {
        return formatToolError(err);
      }
    },
  };
}

export function apply(
  ctx: {
    tools: { register: (tool: ToolDef) => void };
    get?: (name: string) => unknown;
    inject?: (deps: string[], fn: (wctx: never) => void) => void;
    effect?: (fn: () => unknown, name?: string) => void;
  },
  pluginConfig: PluginConfig = {},
) {
  setPluginConfig(pluginConfig);
  const multiOn =
    pluginConfig.multiDraftEnabled === true ||
    pluginConfig.multiDraft?.enabled === true ||
    envMultiDraftFlag();
  setPortConfig({ multiDraftEnabled: multiOn });
  ctx.tools.register(makeEnableTool(pluginConfig));
  // Read-only panel API (GET + accept POST). No tools/prompt cost.
  registerPanelHttpRoutes(ctx as Parameters<typeof registerPanelHttpRoutes>[0], pluginConfig);
}

export { applyTools, SYSTEM_BRIEF };

export const __testing = {
  tools,
  applyTools,
  formatLint,
  SYSTEM_BRIEF,
  formatToolError,
  METHOD_ASSET_IDS,
  listMethodAssets: () => MethodRegistry.list(),
  getMethodAssets: (ids: string[]) => MethodRegistry.getMany(ids),
  auditPayoff: PayoffAuditorPort.audit,
  formatPayoffAudit: PayoffAuditorPort.format,
  ports: {
    AcceptPolicy,
    LintGate,
    BriefGate,
    MethodRegistry,
    SaveBypassGate,
    StyleLinterPort,
    PayoffAuditorPort,
    HumanFeelAuditorPort,
    HumanFeelGate,
    NovelSenseAuditorPort,
    NovelSenseGate,
    LibraryPort,
    InspirationPort,
    ProductMap,
    Scheduler,
    MultiDraftPort,
  },
};
