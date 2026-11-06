import { PLANNER_TOOLS } from "../../../core/src/tool-roles.js";
import type { PluginConfig } from "./types.js";
import type { ToolExecution } from "../../../core/src/tool.js";
import { asObject } from "./parse.js";
import type { GateEngine } from "../../../core/src/gates.js";
import { WriterError } from "../../../core/src/tool.js";
import { withPluginConfig } from "./tools/context.js";
import { withPortConfig } from "./ports/config.js";
import { allTools } from "./tools/index.js";
import { WRITER_EXCLUDED_TOOLS } from "../config.js";
const EDITOR_ENGINE = new Set([
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
  "fanqie_continuity_get",
  "fanqie_method_get",
  "fanqie_method_list",
]);

export function engineTools(
  pluginConfig: PluginConfig = {},
  gates?: GateEngine,
  role: "writer" | "editor" | "planner" = "writer",
) {
  const boundConfig = { ...pluginConfig };
  const policy = {
    multiDraft: { enabled: boundConfig.multiDraft?.enabled === true },
    continuity: { enabled: boundConfig.continuity?.enabled === true },
  };
  const narrowed = role === "writer" && boundConfig.toolset?.narrowed === true;
  return allTools()
    .filter((tool) =>
      role === "planner"
        ? PLANNER_TOOLS.has(tool.name)
        : role === "editor"
          ? EDITOR_ENGINE.has(tool.name)
          : !narrowed || !WRITER_EXCLUDED_TOOLS.has(tool.name),
    )
    .map((tool) => ({
      ...tool,
      execute: async (raw: unknown, exec: ToolExecution) => {
        exec.signal?.throwIfAborted();
        const confirmed = gates?.confirmationArguments(exec);
        const args = confirmed ?? asObject(raw);
        for (const rule of [
          ...(tool.name === "fanqie_chapter_save" && args.status === "final"
            ? ["fanqie.finalize_requires_author"]
            : []),
          // 开关关闭时门禁规则不生效，也不要求确认——工具自身报 continuity_disabled。
          ...(tool.name === "fanqie_continuity_commit" && boundConfig.continuity?.enabled === true
            ? ["fanqie.continuity_commit_requires_author"]
            : []),
          ...(args.force === true ? ["fanqie.force_requires_author"] : []),
        ])
          if (!gates?.consumeConfirmation(exec, rule))
            throw new WriterError(
              "GATE_DENIED",
              "本次敏感操作缺少有效作者确认，请重新读取当前稿后确认",
            );
        return withPluginConfig(boundConfig, () =>
          withPortConfig(policy, () => tool.run(args, exec)),
        );
      },
    }));
}
