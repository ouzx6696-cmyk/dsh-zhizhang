/**
 * dsh-zhizhang — DeepSeek Harness plugin entry (on-demand).
 *
 * The profile mount registers exactly one trigger tool (`zhizhang_enable`) plus the
 * protected Web panel HTTP routes. The full 织章 toolset (count reported at runtime,
 * see allTools()) and the resident hard-rules prompt section are mounted only after
 * the trigger is called, on the calling Agent scope when the host exposes one —
 * standard sessions stay clean.
 */
import { formatToolError } from "./lib/errors.js";
import type { ExecContext } from "./lib/types.js";
import { registerPanelHttpRoutes } from "./lib/http-api.js";
import { applyTools } from "./lib/bootstrap.js";
import { createConfigSchema } from "./lib/config-schema.js";
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
import { SYSTEM_BRIEF, allTools, formatLint, setPluginConfig, } from "./tools/index.js";
export const name = "zhizhang";
export const inject = ["tools"];
/**
 * Standard Schema for the row's `config`: DSH validates it at load, fills the
 * defaults and rejects malformed values instead of letting them fail later.
 */
export const Config = await createConfigSchema();
const tools = allTools();
ProductMap.setToolCount(tools.length);
function enabledReceipt() {
    // Compact orientation only: the full map lives in zhizhang_product_map (tool) and
    // the resident SYSTEM_BRIEF section. Echoing the whole map here cost ~5K chars
    // of context on every enable for content the model can fetch on demand.
    const receipt = [
        `已启用织章（${tools.length} 个工具 + 硬规则，仅本会话）。`,
        Scheduler.formatEnableSummary(),
        "- 未启用前不注入这些工具与系统提示；换会话需重新调用 zhizhang_enable。",
    ].join("\n");
    return receipt;
}
const loadedAgents = new WeakSet();
function makeEnableTool(pluginConfig: any) {
    return {
        name: "zhizhang_enable",
        description: `【按需启用】把织章小说工具（${tools.length} 个）与硬规则加载到当前会话。只有需要拆书 / 写小说 / 改稿时才调用；未调用前这些工具与系统提示都不会注入。启用后调用 zhizhang_product_map 看默认链。`,
        parameters: { type: "object", additionalProperties: false, properties: {}, required: [] },
        output: {
            schema: { type: "string" },
            render: (_args: any, value: string) => [{ type: "text", text: value }],
        },
        async execute(_args: any, exec: ExecContext) {
            try {
                const agentCtx = exec?.agent?.ctx;
                if (!agentCtx || typeof agentCtx.tools?.register !== "function") {
                    return "错误[no_agent_ctx]：当前调用没有可用的 Agent 作用域，无法按会话启用织章；请在新会话重试。";
                }
                if (loadedAgents.has(agentCtx))
                    return enabledReceipt();
                applyTools(agentCtx, pluginConfig);
                loadedAgents.add(agentCtx);
                return enabledReceipt();
            }
            catch (err) {
                return formatToolError(err);
            }
        },
    };
}
export function apply(ctx: any, pluginConfig: any = {}) {
    setPluginConfig(pluginConfig);
    const multiOn = pluginConfig.multiDraftEnabled === true ||
        pluginConfig.multiDraft?.enabled === true ||
        envMultiDraftFlag();
    setPortConfig({ multiDraftEnabled: multiOn });
    ctx.tools.register(makeEnableTool(pluginConfig));
    // Protected panel API (GET + accept POST). No tools/prompt cost.
    registerPanelHttpRoutes(ctx, pluginConfig);
}
export { applyTools, SYSTEM_BRIEF };
export const __testing = {
  tools,
  applyTools,
  enabledReceipt,
  formatLint,
  SYSTEM_BRIEF,
  formatToolError,
    METHOD_ASSET_IDS,
    listMethodAssets: () => MethodRegistry.list(),
    getMethodAssets: (ids: any) => MethodRegistry.getMany(ids),
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
