import { countWords } from "../../storage/primitives.js";
import { stageCandidate } from "../../storage/candidates.js";
import { Scheduler } from "../../ports/index.js";

import { asString, fail, openWork } from "../context.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const candidateStage = defineTool({
  name: "fanqie_candidate_stage",
  description:
    "【默认链】暂存候选到 candidates/（不写 chapters/）。可同章多次 stage（多草稿）；可选 draft_label / variant_group。下一步：candidate_accept（内置扫描，编辑可选）。统一整理见旁路 unify_*（须 multiDraft 开启）。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("目标章节 id"),
    content: S("候选全文"),
    note: S("可选说明"),
    draft_label: S("可选：多草稿标签，如 口气A / v2（不改变默认链）"),
    variant_group: S("可选：同批多草稿分组 id"),
  },
  required: ["chapter", "content"],
  async execute(args, exec) {
    const chapterId = asString(args, "chapter", { required: true });
    const content = asString(args, "content", { required: true, trim: false });
    if (!content.trim()) fail("content 不能为空");
    const { paths, dir, key } = await openWork(exec, args);
    const draftLabel = asString(args, "draft_label");
    const variantGroup = asString(args, "variant_group");
    const cand = await stageCandidate(dir, {
      chapterId,
      body: content,
      note: asString(args, "note") ?? "",
      source: "agent",
      draftLabel: draftLabel || undefined,
      variantGroup: variantGroup || undefined,
    });
    exec.onCandidateStaged?.({
      id: cand.id,
      chapterId: cand.chapterId,
      work: key,
      base: paths.base,
    });
    const labelLine = cand.draftLabel ? `- 标签：${cand.draftLabel}` : null;
    const groupLine = cand.variantGroup ? `- 分组：${cand.variantGroup}` : null;
    return [
      `候选已暂存：${cand.id}`,
      `- 目标章：${cand.chapterId}`,
      `- 约 ${countWords(cand.body)} 字`,
      labelLine,
      groupLine,
      `- 尚未写入章节；确认后调用 fanqie_candidate_accept`,
      `下一步：${Scheduler.nextHint("candidate_stage")}`,
    ]
      .filter(Boolean)
      .join("\n");
  },
});
