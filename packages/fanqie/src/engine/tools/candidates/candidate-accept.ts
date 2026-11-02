import { asString, boolArg, fail } from "../context.js";
import { B, E, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { runAcceptPipeline } from "./context.js";
export const candidateAccept = defineTool({
  name: "fanqie_candidate_accept",
  description:
    "【默认链】采纳候选到章节草稿。默认需要 chapter_brief 依据；采纳内置扫描，已有过期扫描凭据须重扫。编辑路径 A 可传 accept_after_edit + confirm_accept_after_edit；采纳、内容审读与定稿分开。旁路：skip_brief / strict_* / require_payoff / force。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    candidate: S("候选 id（cand-…）"),
    mode: E(["replace", "append"], "默认 replace"),
    expected_revision: S("旧候选缺少基线时，显式核对的现行章节 revision"),
    force: B("目标章为 final 时必须为 true 才允许覆盖（采纳后降为 drafted）"),
    lint_pass_token: S(
      "可选：fanqie_style_lint 返回的 lintPassToken；省略时自动扫描；已有凭据则核对是否仍对应候选正文",
    ),
    skip_brief: B("跳过近期 chapter_brief 硬闸（作者/测试用；默认 false）"),
    strict_lint: B("若 lintHitCount>0 则硬拒（默认 false：仅警告 lint_hits_present）"),
    require_payoff: B(
      "【旁路】无近期 payoff_audit 或 ok=false 则硬拒（默认 false，不要求先跑 audit）",
    ),
    strict_human: B("若人味软雷达命中则硬拒（默认 false：仅警告 human_feel_hits）"),
    strict_novel: B(
      "若书感软雷达命中则硬拒（默认 false：仅警告 novel_sense_hits；与人味闸默认分轨）",
    ),
    accept_after_edit: B(
      "路径 A：声明本候选为编辑稿并采纳到当前工作稿（须同时 confirm_accept_after_edit）",
    ),
    confirm_accept_after_edit: B("路径 A 一次确认：采纳本章编辑稿为当前工作稿（无此旗标不得当 A）"),
  },
  required: ["candidate"],
  async execute(args, exec) {
    const candidateId = asString(args, "candidate", { required: true });
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
      acceptAfterEdit: boolArg(args, "accept_after_edit") ?? false,
      confirmAcceptAfterEdit: boolArg(args, "confirm_accept_after_edit") ?? false,
    });
  },
});
