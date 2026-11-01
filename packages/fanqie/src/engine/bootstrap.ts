/** 按会话挂载引擎工具与硬规则段落（由 mountEngine 调用）。 */
import type { GateEngine } from "../../../core/src/gates.js";
import { WriterError } from "../../../host/src/index.js";
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
export function engineTools(pluginConfig: any = {}, gates?: GateEngine, errors: "text" | "throw" = "throw") {
    const boundConfig = { ...pluginConfig };
    const policy = { multiDraftEnabled: boundConfig.multiDraftEnabled === true || boundConfig.multiDraft?.enabled === true || envMultiDraftFlag() };
    return allTools().map(tool => ({ ...tool, execute: async (args: any, exec: any) => {
        exec?.signal?.throwIfAborted();
        const confirmed = gates?.confirmationArguments(exec);
        args = confirmed || args || {};
        for (const rule of [
            ...(tool.name === "fanqie_chapter_save" && args.status === "final" ? ["fanqie.finalize_requires_author"] : []),
            ...(args.force === true ? ["fanqie.force_requires_author"] : []),
        ]) if (!gates?.consumeConfirmation(exec, rule)) throw new WriterError("GATE_DENIED", "本次敏感操作缺少有效作者确认，请重新读取当前稿后确认");
        return withPluginConfig(boundConfig, () => withPortConfig(policy, () => errors === "throw" ? tool.run(args, exec) : tool.execute(args, exec)));
    } }));
}

export function applyTools(ctx: any, pluginConfig: any, gates?: GateEngine, errors: "text" | "throw" = "throw") {
    if (pluginConfig !== undefined)
        setPluginConfig(pluginConfig);
    const disposers = [];
    try {
        for (const tool of engineTools(pluginConfig, gates, "text")) {
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
