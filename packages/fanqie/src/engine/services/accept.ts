/** Policy evaluation and commit share the same candidate read under the work lock. */
import {
  acceptCandidate,
  getRecentBrief,
  getRecentPayoffAudit,
  readChapter,
} from "../work-store.js";
import {
  AcceptPolicy,
  FoundationPort,
  InspirationPort,
  Scheduler,
  firstDenyCode,
  firstDenyText,
} from "../ports/index.js";
import { getPortConfig } from "../ports/config.js";
import { NovelError, toErrorResult } from "../errors.js";
import { fingerprint } from "../domain/lifecycle.js";
import { resolvePrevBody } from "./chapter-context.js";
export interface AcceptInput {
  paths: import("../types.js").StoragePaths;
  dir: string;
  workKey: string;
  candidateId: string;
  mode?: "append" | "replace";
  lintPassToken?: string;
  expectedRevision?: string;
  force?: boolean;
  skipBrief?: boolean;
  strictLint?: boolean;
  requirePayoff?: boolean;
  strictHuman?: boolean;
  strictNovel?: boolean;
  acceptAfterEdit?: boolean;
  confirmAcceptAfterEdit?: boolean;
  panel?: boolean;
}
export async function runAccept(input: AcceptInput) {
  const { paths, dir, workKey, candidateId, mode = "replace" } = input;
  let receiptLines: string[] = [],
    saved;
  try {
    saved = await acceptCandidate(dir, candidateId, mode, {
      force: input.force,
      expectedRevision: input.expectedRevision,
      lintPassToken: input.lintPassToken,
      validate: async (candidate) => {
        const recentMs = getPortConfig().briefRecentMs;
        const brief = await getRecentBrief(dir, candidate.chapterId, recentMs),
          current = await readChapter(dir, candidate.chapterId),
          record = await getRecentPayoffAudit(dir, candidate.chapterId, recentMs);
        const payoff =
          record?.bodyHash === fingerprint(candidate.body) &&
          record?.outlineHash === fingerprint(current.outline)
            ? record
            : null;
        const craftCue = await InspirationPort.resolveCraftCue(paths, { workKey, limit: 5 }),
          prevBody = await resolvePrevBody(dir, candidate.chapterId);
        const panelEdit = input.panel && candidate.editOf && !input.acceptAfterEdit;
        const acceptAfterEdit = panelEdit ? true : input.acceptAfterEdit,
          confirmAcceptAfterEdit = panelEdit ? true : input.confirmAcceptAfterEdit;
        if (input.panel && candidate.editOf && acceptAfterEdit && !confirmAcceptAfterEdit)
          throw new NovelError(
            "edit_accept_confirm_required",
            "编辑候选路径 A 须明确确认采纳本章编辑稿为当前工作稿。",
          );
        const gate = AcceptPolicy.evaluate({
          candidate,
          brief,
          payoff,
          skipBrief: input.skipBrief,
          strictLint: input.strictLint,
          requirePayoff: input.requirePayoff,
          strictHuman: input.strictHuman,
          strictNovel: input.strictNovel,
          prevBody,
          craftCue,
          acceptAfterEdit,
          confirmAcceptAfterEdit,
        });
        if (!gate.ok) throw new NovelError(firstDenyCode(gate), firstDenyText(gate));
        receiptLines = gate.receiptLines;
        return { outline: fingerprint(current.outline) };
      },
    });
  } catch (error) {
    return toErrorResult(error, "accept_failed");
  }
  const state = saved.stateUpdate;
  const receipt = [
    `已采纳 ${candidateId} →「${saved.title}」（${saved.id}），${saved.wordCount} 字，状态 ${saved.status}。仍需作者审校/定稿。`,
    ...receiptLines,
    ...FoundationPort.acceptReceiptLines({
      threads: state.threads,
      endingVsBodyWarn: state.resolved.warn,
    }),
  ].join("\n");
  return {
    ok: true as const,
    candidateId,
    chapterId: saved.id,
    title: saved.title,
    wordCount: saved.wordCount,
    status: saved.status,
    receipt,
    nextHint: Scheduler.nextHint("candidate_accept"),
  };
}
