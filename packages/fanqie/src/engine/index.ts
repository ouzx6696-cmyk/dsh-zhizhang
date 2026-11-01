/**
 * 番茄长篇引擎：作品存储与创作工具链（fanqie_* 工具 + 硬规则段落）。
 * configureEngine 设置数据位置与端口策略；mountEngine 把工具与硬规则挂到调用方 Agent 作用域（同一作用域只挂一次）。
 */
import type { GateEngine } from "../../../core/src/gates.js";
import { applyTools } from "./bootstrap.js";
import { ProductMap, Scheduler, setPortConfig, envMultiDraftFlag } from "./ports/index.js";
import { SYSTEM_BRIEF, allTools, setPluginConfig } from "./tools/index.js";
import type { PluginConfig } from "./types.js";
const tools = allTools();
ProductMap.setToolCount(tools.length);
/** 启用回执里的引擎概况（工具数 + 默认链提示） */
export function engineSummary() {
    return [`番茄长篇引擎：${tools.length} 个工具 + 硬规则（仅本会话）。`, Scheduler.formatEnableSummary()].join("\n");
}
export function multiDraftOn(config: PluginConfig) {
    return config.multiDraft?.enabled === true || config.multiDraftEnabled === true || envMultiDraftFlag();
}
export function configureEngine(config: PluginConfig = {}) {
    setPluginConfig(config);
    setPortConfig({ multiDraftEnabled: multiDraftOn(config) });
}
const loadedAgents = new WeakSet();
/** 返回是否新挂上 */
export function mountEngine(agentCtx: any, config: PluginConfig = {}, gates?: GateEngine): boolean {
    if (!agentCtx || typeof agentCtx.tools?.register !== "function")
        throw new Error("当前调用没有可用的 Agent 作用域，无法按会话启用番茄长篇；请在新会话重试。");
    if (loadedAgents.has(agentCtx)) return false;
    applyTools(agentCtx, config, gates);
    loadedAgents.add(agentCtx);
    return true;
}
export { applyTools, SYSTEM_BRIEF };
