/**
 * Panel / HTTP accept — same hard gates as zhizhang_candidate_accept.
 * Never silent success: missing confirm / gate fail → structured error.
 */
import {
  acceptCandidate,
  getRecentBrief,
  getRecentPayoffAudit,
  listChapters,
  readCandidate,
  readChapter,
  readWorkMeta,
  resolveWorkDir,
  type StoragePaths,
} from "./store.js";
import {
  AcceptPolicy,
  FoundationPort,
  InspirationPort,
  Scheduler,
  firstDenyCode,
  firstDenyText,
} from "./ports/index.js";
import { ZhizhangError } from "./errors.js";

export interface PanelAcceptRequest {
  work: string;
  candidate: string;
  /** UI must always send true after dialog confirm — never silent. */
  confirm: boolean;
  mode?: "replace" | "append";
  force?: boolean;
  lintPassToken?: string;
  skipBrief?: boolean;
  strictLint?: boolean;
  requirePayoff?: boolean;
  strictHuman?: boolean;
  strictNovel?: boolean;
  acceptAfterEdit?: boolean;
  confirmAcceptAfterEdit?: boolean;
}

export interface PanelAcceptOk {
  ok: true;
  candidateId: string;
  chapterId: string;
  title: string;
  wordCount: number;
  status: string;
  receipt: string;
  nextHint: string;
}

export interface PanelAcceptFail {
  ok: false;
  error: string;
  code: string;
  needConfirm?: boolean;
  needEditConfirm?: boolean;
}

async function resolvePrevBody(dir: string, chapterId: string): Promise<string | null> {
  try {
    const chapters = await listChapters(dir);
    const idx = chapters.findIndex((c) => c.id === chapterId);
    if (idx > 0) {
      const prev = await readChapter(dir, chapters[idx - 1]!.id);
      return prev.body || null;
    }
    if (idx < 0 && chapters.length > 0) {
      const last = chapters[chapters.length - 1]!;
      if (last.id !== chapterId) {
        const prev = await readChapter(dir, last.id);
        return prev.body || null;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Run the same AcceptPolicy + store accept + happened append as the tool.
 * Panel always requires `confirm===true` (misclick guard). Edit path A additionally
 * needs confirmAcceptAfterEdit (or acceptAfterEdit+confirmAcceptAfterEdit).
 */
export async function runPanelAccept(
  paths: StoragePaths,
  req: PanelAcceptRequest,
): Promise<PanelAcceptOk | PanelAcceptFail> {
  const workKey = String(req.work ?? "").trim();
  const candidateId = String(req.candidate ?? "").trim();
  if (!workKey) return { ok: false, code: "bad_args", error: "work 不能为空" };
  if (!candidateId) return { ok: false, code: "bad_args", error: "candidate 不能为空" };

  if (!req.confirm) {
    return {
      ok: false,
      code: "confirm_required",
      error: "面板采纳须二次确认：传 confirm=true。禁止静默成功。",
      needConfirm: true,
    };
  }

  let dir: string;
  try {
    dir = await resolveWorkDir(paths, workKey);
  } catch (err) {
    return {
      ok: false,
      code: err instanceof ZhizhangError ? err.code : "work_not_found",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let candMeta;
  try {
    candMeta = await readCandidate(dir, candidateId);
  } catch (err) {
    return {
      ok: false,
      code: err instanceof ZhizhangError ? err.code : "candidate_not_found",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const isEdit = Boolean(candMeta.editOf);
  let acceptAfterEdit = Boolean(req.acceptAfterEdit);
  let confirmAcceptAfterEdit = Boolean(req.confirmAcceptAfterEdit);
  // Panel: if user confirms an edit candidate, treat as path A with confirm.
  if (isEdit && req.confirm && !acceptAfterEdit) {
    acceptAfterEdit = true;
    confirmAcceptAfterEdit = true;
  }
  if (isEdit && acceptAfterEdit && !confirmAcceptAfterEdit) {
    return {
      ok: false,
      code: "edit_accept_confirm_required",
      error:
        "编辑候选路径 A 须 confirm_accept_after_edit=true（确认：采纳本章编辑稿并验收为正式章）。禁止静默验收。",
      needEditConfirm: true,
      needConfirm: true,
    };
  }

  const brief = await getRecentBrief(dir, candMeta.chapterId);
  const payoff = await getRecentPayoffAudit(dir, candMeta.chapterId);
  const craftCue = await InspirationPort.resolveCraftCue(paths, {
    workKey,
    limit: 5,
  });
  const prevBody = await resolvePrevBody(dir, candMeta.chapterId);

  const gate = AcceptPolicy.evaluate({
    candidate: candMeta,
    brief,
    payoff,
    skipBrief: Boolean(req.skipBrief),
    strictLint: Boolean(req.strictLint),
    requirePayoff: Boolean(req.requirePayoff),
    strictHuman: Boolean(req.strictHuman),
    strictNovel: Boolean(req.strictNovel),
    prevBody,
    craftCue,
    acceptAfterEdit,
    confirmAcceptAfterEdit,
  });
  if (!gate.ok) {
    return {
      ok: false,
      code: firstDenyCode(gate),
      error: firstDenyText(gate),
    };
  }

  const mode = req.mode === "append" ? "append" : "replace";
  let saved;
  try {
    saved = await acceptCandidate(dir, candidateId, mode, {
      force: Boolean(req.force),
      lintPassToken: req.lintPassToken?.trim() || undefined,
    });
  } catch (err) {
    return {
      ok: false,
      code: err instanceof ZhizhangError ? err.code : "accept_failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  let ending = "";
  let body = "";
  try {
    const ch = await readChapter(dir, saved.id);
    ending = ch.outline.ending || "";
    body = ch.body || "";
  } catch {
    ending = "";
    body = "";
  }
  const resolved = FoundationPort.resolveHappenedText({ ending, body });
  const meta = await readWorkMeta(dir);
  const append = await FoundationPort.appendHappened(dir, {
    chapterId: saved.id,
    title: saved.title,
    text: resolved.text,
  });
  const happenedLines = FoundationPort.acceptReceiptLines({
    chapterId: saved.id,
    title: saved.title,
    ending,
    threads: meta.foundation.threads,
    append,
    happenedSource: resolved.source,
    endingVsBodyWarn: resolved.warn,
  });

  const receipt = [
    `已采纳 ${candidateId} →「${saved.title}」（${saved.id}），${saved.wordCount} 字，状态 ${saved.status}。仍需作者审校/定稿。`,
    ...gate.receiptLines,
    ...happenedLines,
  ].join("\n");

  return {
    ok: true,
    candidateId,
    chapterId: saved.id,
    title: saved.title,
    wordCount: saved.wordCount,
    status: saved.status,
    receipt,
    nextHint: Scheduler.nextHint("candidate_accept"),
  };
}
