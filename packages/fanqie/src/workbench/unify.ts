import type { StoragePaths } from "../engine/types.js";

import { listCandidates, readCandidate, resolveWorkDir } from "../engine/work-store.js";

import { NovelError } from "../engine/errors.js";
import { MultiDraftPort } from "../engine/ports/multi-draft.js";

/** Read-only unify brief pack — no disk writes. */
export async function prepareUnifyBrief(
  paths: StoragePaths,
  opts: { work: string; chapter: string; candidateIds: string[] },
) {
  if (!MultiDraftPort.isEnabled()) {
    return {
      ok: false,
      enabled: false,
      code: MultiDraftPort.disabledCode,
      error: `多草稿统一整理未开启。${MultiDraftPort.enableHint()}`,
    };
  }
  const work = opts.work;
  if (!work) {
    return { ok: false, enabled: true, code: "bad_args", error: "work 必填" };
  }
  let dir;
  try {
    dir = await resolveWorkDir(paths, work);
  } catch (err) {
    if (!(err instanceof NovelError && err.code === "work_not_found")) throw err;
    return {
      ok: false,
      enabled: true,
      code: "work_not_found",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  let ids = opts.candidateIds;
  const chapterArg = opts.chapter;
  if (ids.length === 0) {
    if (!chapterArg) {
      return { ok: false, enabled: true, code: "bad_args", error: "请传 chapter 或 candidateIds" };
    }
    const pending = (await listCandidates(dir)).filter(
      (c) => c.pending && c.chapterId === chapterArg,
    );
    ids = pending.map((c) => c.id);
  }
  if (ids.length < 2) {
    return {
      ok: false,
      enabled: true,
      code: "unify_need_two",
      error: `统一整理至少 2 条待采纳，当前 ${ids.length}`,
    };
  }
  try {
    const parents = [];
    for (const id of ids) {
      const cand = await readCandidate(dir, id);
      if (cand.acceptedAt) {
        return {
          ok: false,
          enabled: true,
          code: "unify_parent_accepted",
          error: `候选 ${id} 已采纳`,
        };
      }
      parents.push(cand);
    }
    const chapterId = parents[0].chapterId;
    for (const p of parents) {
      if (p.chapterId !== chapterId) {
        return {
          ok: false,
          enabled: true,
          code: "unify_chapter_mismatch",
          error: "父候选必须同章",
        };
      }
    }
    if (chapterArg && chapterArg !== chapterId) {
      return {
        ok: false,
        enabled: true,
        code: "unify_chapter_mismatch",
        error: `chapter=${chapterArg} 与候选章 ${chapterId} 不一致`,
      };
    }
    const views = parents.map((p) => MultiDraftPort.parentView(p));
    const brief = MultiDraftPort.formatUnifyBrief({
      chapterId,
      workKey: work,
      parents: views,
    });
    return {
      ok: true,
      enabled: true,
      chapterId,
      candidateIds: ids,
      brief,
      parents: views.map((v) => ({
        id: v.id,
        draftLabel: v.draftLabel,
        wordCount: v.wordCount,
      })),
    };
  } catch (err) {
    const code = err instanceof NovelError ? err.code : "unify_prepare_failed";
    return {
      ok: false,
      enabled: true,
      code,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
