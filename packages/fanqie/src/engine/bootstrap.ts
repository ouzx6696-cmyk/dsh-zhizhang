import type { GateEngine } from "../../../core/src/gates.js";
import { WriterError } from "../../../core/src/tool.js";
import { withPluginConfig } from "./tools/context.js";
import { withPortConfig } from "./ports/config.js";
import { envMultiDraftFlag } from "./ports/multi-draft.js";
import { allTools, } from "./tools/index.js";
export const EDITOR_ENGINE = new Set([
  "fanqie_project_list",
  "fanqie_project_open",
  "fanqie_status",
  "fanqie_foundation_get",
  "fanqie_outline_get",
  "fanqie_chapter_list",
  "fanqie_chapter_read",
  "fanqie_chapter_drafts",
  "fanqie_candidate_edit_brief",
  "fanqie_candidate_edit_stage",
  "fanqie_style_lint",
  "fanqie_payoff_audit",
  "fanqie_human_feel_audit",
  "fanqie_novel_sense_audit",
  "fanqie_review_ledger",
  "fanqie_method_get",
  "fanqie_method_list",
]);

export function engineTools(pluginConfig: any = {}, gates?: GateEngine, errors: "text" | "throw" = "throw", role: "writer" | "editor" = "writer") {
    const boundConfig = { ...pluginConfig };
    const policy = { multiDraftEnabled: boundConfig.multiDraftEnabled === true || boundConfig.multiDraft?.enabled === true || envMultiDraftFlag() };
    return allTools().filter(tool => role !== "editor" || EDITOR_ENGINE.has(tool.name)).map(tool => ({ ...tool, execute: async (args: any, exec: any) => {
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
