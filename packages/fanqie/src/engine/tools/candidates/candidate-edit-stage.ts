import { countWords } from "../../storage/primitives.js";
import { readCandidate, stageCandidate } from "../../storage/candidates.js";
import { EditPort, Scheduler, auditHumanFeel, getPortConfig } from "../../ports/index.js";

import { asString, fail, openWork } from "../context.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const candidateEditStage = defineTool({
  name: "fanqie_candidate_edit_stage",
  description:
    "【默认链·可选编辑】将编辑后正文暂存为新候选（editOf=写手候选；不写正式章）。随后按授权采纳或保留候选；A/B/C 兼容可用。禁止本工具内 accept。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    parent: S("写手候选 id（被编辑的源候选）"),
    content: S("编辑后全文"),
    mode: S("润色模式，默认 polish-depolish"),
    note: S("可选说明"),
  },
  required: ["parent", "content"],
  async execute(args, exec) {
    const parentId = asString(args, "parent", { required: true });
    const content = asString(args, "content", { required: true, trim: false });
    if (!content.trim()) fail("content 不能为空");
    const cfg = getPortConfig();
    const mode = EditPort.normalizeMode(asString(args, "mode") ?? cfg.defaultEditMode);
    const { paths, dir, key } = await openWork(exec, args);
    const parent = await readCandidate(dir, parentId);
    if (parent.acceptedAt) {
      fail(
        `源候选 ${parentId} 已采纳，无法再挂编辑。请重新 stage 写手稿后再编辑。`,
        "edit_parent_accepted",
      );
    }
    const cand = await stageCandidate(dir, {
      chapterId: parent.chapterId,
      body: content,
      note: asString(args, "note") ?? `edit of ${parentId} · ${mode}`,
      source: "edit",
      editOf: parentId,
      editMode: mode,
    });
    exec.onCandidateStaged?.({
      id: cand.id,
      chapterId: cand.chapterId,
      work: key,
      base: paths.base,
    });
    const soft = auditHumanFeel(cand.body, {});
    const softHits = soft.hits.map((h) => ({ code: h.code, text: h.text }));
    return [
      ...EditPort.afterStageLines({
        editCandId: cand.id,
        parentCandId: parentId,
        mode,
        chapterId: cand.chapterId,
        softHits,
      }),
      `- 约 ${countWords(cand.body)} 字`,
      `下一步：${Scheduler.nextHint("candidate_edit_stage")}`,
    ].join("\n");
  },
});
