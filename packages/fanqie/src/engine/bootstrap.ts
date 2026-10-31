/** 按会话挂载引擎工具与硬规则段落（由 mountEngine 调用）。 */
import { withPluginConfig } from "./tools/context.js";
import { withPortConfig } from "./ports/config.js";
import { envMultiDraftFlag } from "./ports/multi-draft.js";
import { allTools, SYSTEM_BRIEF, setPluginConfig, } from "./tools/index.js";
/**
 * Register every engine tool and the resident hard-rules section on `ctx`.
 * @param ctx Agent-scoped context (`agent.ctx`) or a plain registration context.
 * @param pluginConfig Plugin config to apply before tool construction.
 * @returns Disposers for every registration (unwinds a partial mount on failure).
 */
export function engineTools(pluginConfig: any = {}) {
    const boundConfig = { ...pluginConfig };
    const policy = { multiDraftEnabled: boundConfig.multiDraftEnabled === true || boundConfig.multiDraft?.enabled === true || envMultiDraftFlag() };
    return allTools().map(tool => ({ ...tool, execute: (args: any, exec: any) => withPluginConfig(boundConfig, () => withPortConfig(policy, () => tool.execute(args, exec))) }));
}

export function applyTools(ctx: any, pluginConfig: any) {
    if (pluginConfig !== undefined)
        setPluginConfig(pluginConfig);
    const disposers = [];
    try {
        for (const tool of engineTools(pluginConfig)) {
            disposers.push(ctx.tools.register(tool));
        }
        const systemPrompt = ctx.get?.("systemPrompt");
        if (systemPrompt && typeof systemPrompt.section === "function") {
            disposers.push(systemPrompt.section({
                name: "tool:writer-fanqie-engine",
                order: 108,
                text: () => SYSTEM_BRIEF,
            }));
        }
        return disposers;
    }
    catch (error) {
        for (const dispose of disposers) {
            try {
                if (typeof dispose === "function")
                    dispose();
            }
            catch {
                /* best-effort rollback */
            }
        }
        throw error;
    }
}
