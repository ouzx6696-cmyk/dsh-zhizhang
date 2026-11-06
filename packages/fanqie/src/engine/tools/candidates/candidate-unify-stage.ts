import { countWords } from "../../storage/primitives.js";
import { readCandidate, stageCandidate } from "../../storage/candidates.js";
import { MultiDraftPort } from "../../ports/index.js";

import { asString, asStringArray, fail, openWork } from "../context.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const candidateUnifyStage = defineTool({
  name: "fanqie_candidate_unify_stage",
  description:
    "【旁路·多草稿】将统一整理正文暂存为新候选（source=unify，unifyOf=父 ids；不写正式章）。须 multiDraft 开启。下一步：candidate_accept（内置扫描）。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    content: S("整理后的本章全文"),
    candidate_ids: {
      type: "array",
      items: { type: "string" },
      description: "父候选 id 列表（≥2，须同章待采纳）",
    },
    note: S("可选说明"),
    draft_label: S("可选：整理稿标签，默认「统一整理」"),
  },
  required: ["content", "candidate_ids"],
  async execute(args, exec) {
    try {
      MultiDraftPort.requireEnabled();
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      fail(
        err.message,
        ("code" in err && typeof err.code === "string" && err.code) || MultiDraftPort.disabledCode,
      );
    }
    const content = asString(args, "content", { required: true, trim: false });
    if (!content.trim()) fail("content 不能为空");
    const ids = asStringArray(args, "candidate_ids") ?? [];
    if (ids.length < 2) fail("candidate_ids 至少 2 个", "unify_need_two");
    const { paths, dir, key } = await openWork(exec, args);
    const parents = [];
    for (const id of ids) {
      const cand = await readCandidate(dir, id);
      if (cand.acceptedAt) {
        fail(`父候选 ${id} 已采纳`, "unify_parent_accepted");
      }
      parents.push(cand);
    }
    const chapterId = parents[0].chapterId;
    for (const p of parents) {
      if (p.chapterId !== chapterId) {
        fail("父候选必须同章", "unify_chapter_mismatch");
      }
    }
    const label = asString(args, "draft_label") || "统一整理";
    const cand = await stageCandidate(dir, {
      chapterId,
      body: content,
      note: asString(args, "note") ?? `unify of ${ids.join(",")}`,
      source: "unify",
      unifyOf: ids,
      draftLabel: label,
    });
    exec.onCandidateStaged?.({
      id: cand.id,
      chapterId: cand.chapterId,
      work: key,
      base: paths.base,
    });
    return MultiDraftPort.afterUnifyStageLines({
      unifyCandId: cand.id,
      parentIds: ids,
      chapterId,
      wordCount: countWords(cand.body),
    }).join("\n");
  },
});
