import { countWords } from "../../storage/primitives.js";
import { readCandidate } from "../../storage/candidates.js";
import { EditPort, Scheduler, getPortConfig } from "../../ports/index.js";

import { asString, openWork } from "../context.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const candidateEditBrief = defineTool({
  name: "fanqie_candidate_edit_brief",
  description:
    "【默认链·可选编辑】取出编辑过稿 brief（默认 polish-depolish）。Agent 按 brief 改写正文后调用 edit_stage；按真实授权采纳或保留候选；A/B/C 兼容可用，采纳不代表定稿。方法：fanqie_method_get ids=edit",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    mode: S(
      "润色模式，默认 polish-depolish；也可 polish-rhythm / condense / expand / style / literary / proofread",
    ),
    candidate: S("可选：写手候选 id，回执带上源候选便于 edit_stage"),
    should_land: S("可选：本场应落纸一行正向（打碎僵硬）"),
    situation: S("可选：本章处境/冲突摘要"),
  },
  required: [],
  async execute(args, exec) {
    const cfg = getPortConfig();
    const mode = EditPort.normalizeMode(asString(args, "mode") ?? cfg.defaultEditMode);
    const candidateId = asString(args, "candidate");
    let parentHint = "";
    if (candidateId) {
      const { dir } = await openWork(exec, args);
      const cand = await readCandidate(dir, candidateId);
      parentHint = `\n源写手候选：${cand.id}（章 ${cand.chapterId}，约 ${countWords(cand.body)} 字）\n改写后：fanqie_candidate_edit_stage(parent=${cand.id}, content=…, mode=${mode})`;
    }
    const brief = EditPort.formatEditBrief({
      mode,
      shouldLandLine: asString(args, "should_land"),
      situation: asString(args, "situation"),
    });
    return [brief, parentHint, "", `下一步：${Scheduler.nextHint("style_lint")}`]
      .filter(Boolean)
      .join("\n");
  },
});
