import { readCandidate } from "../../storage/candidates.js";
import { EditPort, Scheduler } from "../../ports/index.js";

import { asString, boolArg, fail, openWork } from "../context.js";
import { B, E, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { runAcceptPipeline } from "./context.js";
export const candidateEditDecide = defineTool({
  name: "fanqie_candidate_edit_decide",
  description:
    "【默认链·可选编辑】用户对编辑候选显式选 A/B/C。A=一次确认应用编辑并 accept（须 confirm_accept_after_edit=true，采纳时自动扫描；已有过期凭据须重扫）；B=仅确认候选、正式章不变；C=拒编辑。禁止静默 A。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    candidate: S("编辑候选 id（须带 editOf）"),
    choice: E(["A", "B", "C"], "用户抉择"),
    confirm_accept_after_edit: B("路径 A 必填 true：确认采纳本章编辑稿为当前工作稿"),
    mode: E(["replace", "append"], "A 时写入模式，默认 replace"),
    expected_revision: S("旧候选缺少基线时，显式核对的现行章节 revision"),
    force: B("A 且目标章 final 时须 true"),
    lint_pass_token: S("A 可选：显式 lintPassToken"),
    skip_brief: B("A 时跳过 brief 硬闸"),
    strict_lint: B("A 时 lint 命中硬拒"),
    require_payoff: B("A 时要求 payoff"),
    strict_human: B("A 时人味硬拒"),
    strict_novel: B("A 时书感硬拒"),
  },
  required: ["candidate", "choice"],
  async execute(args, exec) {
    const candidateId = asString(args, "candidate", { required: true });
    const choiceRaw = asString(args, "choice", { required: true });
    const choice = EditPort.resolveChoice(choiceRaw);
    if (!choice) fail("choice 须为 A / B / C", "edit_choice_invalid");
    const { dir } = await openWork(exec, args);
    const cand = await readCandidate(dir, candidateId);
    if (!cand.editOf) {
      fail(
        `候选 ${candidateId} 不是编辑产物（无 editOf）。请对 edit_stage 结果调用本工具。`,
        "edit_accept_not_an_edit",
      );
    }
    if (choice === "C") {
      return [
        ...EditPort.decideChoiceLines("C", {
          candId: candidateId,
          parentId: cand.editOf,
          mode: cand.editMode,
        }),
        `下一步：${Scheduler.nextHint("candidate_edit_decide_c")}`,
      ].join("\n");
    }
    if (choice === "B") {
      return [
        ...EditPort.decideChoiceLines("B", {
          candId: candidateId,
          parentId: cand.editOf,
          mode: cand.editMode,
        }),
        `下一步：${Scheduler.nextHint("candidate_edit_decide_b")}`,
      ].join("\n");
    }
    // A — require confirm; then full accept pipeline
    const confirmed = boolArg(args, "confirm_accept_after_edit") === true;
    if (!confirmed) {
      fail(
        "路径 A 须一次显式确认：传 confirm_accept_after_edit=true（确认：采纳本章编辑稿为当前工作稿）。禁止静默验收。",
        "edit_accept_confirm_required",
      );
    }
    const mode = asString(args, "mode") ?? "replace";
    if (mode !== "append" && mode !== "replace") fail("mode 只支持 append / replace", "bad_args");
    return runAcceptPipeline(args, exec, {
      candidateId,
      mode,
      expectedRevision: asString(args, "expected_revision"),
      force: boolArg(args, "force") ?? false,
      lintPassToken: asString(args, "lint_pass_token") ?? undefined,
      skipBrief: boolArg(args, "skip_brief") ?? false,
      strictLint: boolArg(args, "strict_lint"),
      requirePayoff: boolArg(args, "require_payoff"),
      strictHuman: boolArg(args, "strict_human"),
      strictNovel: boolArg(args, "strict_novel"),
      acceptAfterEdit: true,
      confirmAcceptAfterEdit: true,
    });
  },
});
