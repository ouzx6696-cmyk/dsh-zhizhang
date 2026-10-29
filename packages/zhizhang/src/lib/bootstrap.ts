import { registerHostTool, addPromptSection } from '../../../dsh-adapter/dist/index.js';
/**
 * Heavy tool layer for zhizhang — mounted on demand (per Agent scope when the host
 * exposes one). Kept out of the plugin entry so a profile mount injects only the
 * single `zhizhang_enable` trigger.
 */
import { withPluginConfig } from "../tools/context.js";
import { withPortConfig } from "./ports/config.js";
import { envMultiDraftFlag } from "./ports/multi-draft.js";
import { allTools, SYSTEM_BRIEF, setPluginConfig, } from "../tools/index.js";
/**
 * Register every 织章 tool and the resident hard-rules section on `ctx`.
 * @param ctx Agent-scoped context (`agent.ctx`) or a plain registration context.
 * @param pluginConfig Plugin config to apply before tool construction.
 * @returns Disposers for every registration (unwinds a partial mount on failure).
 */
export function applyTools(ctx: any, pluginConfig: any) {
    if (pluginConfig !== undefined)
        setPluginConfig(pluginConfig);
    const boundConfig = { ...(pluginConfig ?? {}) };
    const policy = { multiDraftEnabled: boundConfig.multiDraftEnabled === true || boundConfig.multiDraft?.enabled === true || envMultiDraftFlag() };
    const disposers = [];
    try {
        for (const tool of allTools()) {
            disposers.push(registerHostTool(ctx, { ...tool, execute: (args: any, exec: any) => withPluginConfig(boundConfig, () => withPortConfig(policy, () => tool.execute(args, exec))) }));
        }
        const section = addPromptSection(ctx, 'tool:zhizhang', 108, () => SYSTEM_BRIEF);
        if (section) disposers.push(section);
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
