import { readCandidate } from "../../storage/candidates.js";
import { readChapter } from "../../storage/chapters.js";
import { NovelError } from "../../errors.js";

import { HumanFeelAuditorPort, InspirationPort } from "../../ports/index.js";

import { asString, fail, openWork } from "../context.js";

import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const humanFeelAudit = defineTool({
  name: "fanqie_human_feel_audit",
  description:
    "【旁路·诊断】人味软雷达（含 craftCue→stiffness_tidy，与 Accept 同口径）。Accept 已内嵌；本工具仅诊断旁路。只诊断，不签发 token；strict_human 为旁路硬拒。不作质量法。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    candidate: S("可选：候选 id，扫其正文"),
    chapter: S("可选：章节 id，读盘扫描"),
    text: S("可选：直接扫描这段文本"),
  },
  required: [],
  async execute(args, exec) {
    const candidateId = asString(args, "candidate");
    let text = asString(args, "text", { trim: false });
    let label = "传入文本";
    let craftCue = "";
    if (candidateId) {
      const { dir, paths, key } = await openWork(exec, args);
      const cand = await readCandidate(dir, candidateId);
      text = cand.body;
      label = `候选 ${candidateId} → ${cand.chapterId}`;
      craftCue = await InspirationPort.resolveCraftCue(paths, { workKey: key, limit: 5 });
    } else if (text === undefined) {
      const chapterId = asString(args, "chapter");
      if (!chapterId) fail("请提供 candidate、text 或 chapter");
      const { dir, paths, key } = await openWork(exec, args);
      const ch = await readChapter(dir, chapterId);
      text = ch.body;
      label = `${ch.title}（${ch.id}）`;
      craftCue = await InspirationPort.resolveCraftCue(paths, { workKey: key, limit: 5 });
    } else {
      // 纯文本扫描不依赖作品：只在没有作品可挂 craftCue 时降级，其余故障照常抛出。
      try {
        const { paths, key } = await openWork(exec, args);
        craftCue = await InspirationPort.resolveCraftCue(paths, { workKey: key, limit: 5 });
      } catch (err) {
        if (!(err instanceof NovelError && err.code === "no_work")) throw err;
        craftCue = "";
      }
    }
    if (!text?.trim()) fail("正文为空，无法人味审计");
    const result = HumanFeelAuditorPort.audit(text, { craftCue });
    return HumanFeelAuditorPort.format(label, result);
  },
});
