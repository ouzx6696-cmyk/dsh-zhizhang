import { listCandidates, readCandidate } from "../../storage/candidates.js";
import { MultiDraftPort, Scheduler } from "../../ports/index.js";

import { asString, asStringArray, fail, openWork } from "../context.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const candidateUnifyBrief = defineTool({
  name: "fanqie_candidate_unify_brief",
  description:
    "【旁路·多草稿】取出统一整理 brief（须 multiDraft 开启）。合并 ≥2 条同章待采纳；省略 candidate_ids 则取本章全部待采纳。下一步：整理正文 → unify_stage。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id（与 candidate_ids 二选一必填一侧；有 ids 时可从父稿推断章）"),
    candidate_ids: {
      type: "array",
      items: { type: "string" },
      description: "可选：要合并的待采纳候选 id（≥2）；省略则用本章全部待采纳",
    },
  },
  required: [],
  async execute(args, exec) {
    try {
      MultiDraftPort.requireEnabled();
    } catch (err) {
      if (!(err instanceof Error)) throw err;
      fail(err.message, ("code" in err && typeof err.code === "string" && err.code) || MultiDraftPort.disabledCode);
    }
    const { dir, key } = await openWork(exec, args);
    let ids = asStringArray(args, "candidate_ids") ?? [];
    const chapterArg = asString(args, "chapter");
    if (ids.length === 0) {
      if (!chapterArg) fail("请传 chapter，或传 candidate_ids（≥2）");
      const pending = (await listCandidates(dir)).filter(
        (c) => c.pending && c.chapterId === chapterArg,
      );
      ids = pending.map((c) => c.id);
    }
    if (ids.length < 2) {
      fail(
        `统一整理至少需要 2 条待采纳候选，当前 ${ids.length} 条。可先多次 candidate_stage(draft_label)。`,
        "unify_need_two",
      );
    }
    const parents = [];
    for (const id of ids) {
      const cand = await readCandidate(dir, id);
      if (cand.acceptedAt) {
        fail(`候选 ${id} 已采纳，不能参与统一整理`, "unify_parent_accepted");
      }
      parents.push(cand);
    }
    const chapterId = parents[0].chapterId;
    for (const p of parents) {
      if (p.chapterId !== chapterId) {
        fail(
          `候选不在同一章：${parents.map((x) => `${x.id}=${x.chapterId}`).join("、")}`,
          "unify_chapter_mismatch",
        );
      }
    }
    if (chapterArg && chapterArg !== chapterId) {
      fail(`chapter=${chapterArg} 与候选章 ${chapterId} 不一致`, "unify_chapter_mismatch");
    }
    const brief = MultiDraftPort.formatUnifyBrief({
      chapterId,
      workKey: key,
      parents: parents.map((p) => MultiDraftPort.parentView(p)),
    });
    return [
      brief,
      "",
      `父 ids：${ids.join(", ")}`,
      `下一步：${Scheduler.nextHint("candidate_unify_brief")}`,
    ].join("\n");
  },
});
