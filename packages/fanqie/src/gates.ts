/** Author confirmation rules pin the current chapter revision before approval. */
import { WriterError } from "../../core/src/tool.js";
import { readChapter as readStoredChapter } from "./engine/storage/chapters.js";
import type { GateOutcome, GateRule } from "../../core/src/gates.js";
import type { FanqieConfig } from "./config.js";
import { bodyFingerprint, editorPassProblem } from "./review.js";
import { openWork } from "./works.js";
import type { Role } from "./tools.js";

/** 采纳链旁路开关（scheduler 的 accept.flags 旁路）：都是默认 false 的布尔参数，显式传 true 才算设置。 */
const NARROWED_ACCEPT_FLAGS = [
  "skip_brief",
  "strict_lint",
  "require_payoff",
  "strict_human",
  "strict_novel",
  "force",
] as const;

/** 收窄写手不得用采纳旁路开关：只拦显式 true，无参或显式 false（等于默认值）的调用零影响。 */
function narrowedFlagRules(): GateRule[] {
  const check = (args: Record<string, unknown>): GateOutcome => {
    const enabled = NARROWED_ACCEPT_FLAGS.filter((flag) => args[flag] === true);
    if (!enabled.length) return undefined;
    return {
      kind: "deny",
      reason: `写手默认工具集不开放 ${enabled.join("、")} 参数；该旁路属规划/诊断用途，请在任务说明里说明需求或由作者在规划角色执行。`,
    };
  };
  const rule = (id: string, tool: string): GateRule => ({
    id,
    tool,
    locked: true,
    description: "收窄写手默认集不开放采纳旁路参数",
    check,
  });
  return [
    rule("fanqie.writer_narrowed_accept_flags", "fanqie_candidate_accept"),
    rule("fanqie.writer_narrowed_edit_flags", "fanqie_candidate_edit_decide"),
  ];
}

export function fanqieGateRules(config: FanqieConfig, role: Role): GateRule[] {
  if (role === "editor") return [];
  const rules: GateRule[] = [
    {
      id: "fanqie.finalize_requires_author",
      tool: "fanqie_chapter_save",
      locked: true,
      description: "定稿须作者确认",
      async check(args, exec) {
        if (args.status !== "final") return undefined;
        await pinChapter(args, exec, config);
        return {
          kind: "ask",
          reason: `把「${String(args.chapter ?? args.id ?? "本章")}」定稿（final）需要作者确认。审读通过不自动获得定稿权。`,
        };
      },
    },
    {
      id: "fanqie.force_requires_author",
      tool: "fanqie_*",
      locked: true,
      description: "force 覆盖定稿须作者确认",
      async check(args, exec) {
        if (args.force !== true) return undefined;
        if (exec.name === "fanqie_chapter_save") await pinChapter(args, exec, config);
        return {
          kind: "ask",
          reason: `${exec.name} 带 force=true，会覆盖已定稿正文（降回草稿、需重新审读），需要作者确认。`,
        };
      },
    },
    {
      id: "fanqie.continuity_commit_requires_author",
      tool: "fanqie_continuity_commit",
      locked: true,
      description: "连续性核验落盘（commits/handoff/线状态）须作者确认",
      async check(args, exec) {
        // 开关关闭时工具自身会报 continuity_disabled；这里不弹确认。
        if (config.continuity?.enabled !== true) return undefined;
        const w = await openWork(
          exec,
          typeof args.work === "string" ? args.work : undefined,
          typeof args.working_dir === "string" ? args.working_dir : undefined,
        );
        const ch = await readStoredChapter(w.dir, String(args.chapter ?? ""));
        args.work = w.key;
        // 绑定作者确认时看到的正文版本；正文变化后旧确认不作数。
        args.revision ??= ch.revision;
        return {
          kind: "ask",
          reason: `连续性核验将写入「${ch.title}」（${ch.id}，revision ${ch.revision.slice(0, 8)}…）的 commits 与 handoff 并推进伏笔线状态，需要作者确认。`,
        };
      },
    },
    {
      // A-02 (G5): the Full cost receipt hands the model its own confirm_token, so the token
      // alone is self-approval. The author confirms here before a Full plan replaces anything.
      id: "fanqie.full_dissect_requires_author",
      tool: "fanqie_library_plan",
      locked: true,
      description: "Full 拆书须作者确认",
      async check(args) {
        if (args.confirm_full !== true) return undefined;
        return {
          kind: "ask",
          reason: `对书源「${String(args.source ?? "")}」执行 Full 全量拆书会按成本回执逐批阅读全书，需要作者确认。`,
        };
      },
    },
  ];
  if (role === "writer" && config.toolset?.narrowed === true) rules.push(...narrowedFlagRules());
  return rules;
}

async function pinChapter(
  args: Record<string, unknown>,
  exec: import("../../core/src/tool.js").ToolExecution,
  config: FanqieConfig,
) {
  const w = await openWork(
    exec,
    typeof args.work === "string" ? args.work : undefined,
    typeof args.working_dir === "string" ? args.working_dir : undefined,
  );
  const ch = await readStoredChapter(w.dir, String(args.chapter ?? ""));
  // Validate before asking, then bind approval to the revision the author saw.
  if (args.status === "final" && config.requireEditorPass) {
    const problem = await editorPassProblem(
      w.dir,
      ch,
      bodyFingerprint(typeof args.content === "string" ? args.content : ch.body),
    );
    if (problem) throw new WriterError("GATE_DENIED", problem);
  }
  args.work = w.key;
  args.expected_revision ??= ch.revision;
}
