/**
 * Panel / HTTP accept — 与 zhizhang_candidate_accept 共用 services/accept.js。
 * 面板额外要求 confirm=true（防误点）；编辑候选按路径 A 自动补确认。
 */
import { readCandidate, resolveWorkDir } from "./store.js";
import { runAccept } from "./services/accept.js";
import { ZhizhangError } from "./errors.js";
function fail(err, fallback) {
    return {
        ok: false,
        code: err instanceof ZhizhangError ? err.code : fallback,
        error: err instanceof Error ? err.message : String(err),
    };
}
export async function runPanelAccept(paths, req) {
    const workKey = String(req.work ?? "").trim();
    const candidateId = String(req.candidate ?? "").trim();
    if (!workKey)
        return { ok: false, code: "bad_args", error: "work 不能为空" };
    if (!candidateId)
        return { ok: false, code: "bad_args", error: "candidate 不能为空" };
    if (!req.confirm) {
        return {
            ok: false,
            code: "confirm_required",
            error: "面板采纳须二次确认：传 confirm=true。禁止静默成功。",
            needConfirm: true,
        };
    }
    let dir;
    try {
        dir = await resolveWorkDir(paths, workKey);
    }
    catch (err) {
        return fail(err, "work_not_found");
    }
    let candMeta;
    try {
        candMeta = await readCandidate(dir, candidateId);
    }
    catch (err) {
        return fail(err, "candidate_not_found");
    }
    const isEdit = Boolean(candMeta.editOf);
    let acceptAfterEdit = Boolean(req.acceptAfterEdit);
    let confirmAcceptAfterEdit = Boolean(req.confirmAcceptAfterEdit);
    if (isEdit && !acceptAfterEdit) {
        acceptAfterEdit = true;
        confirmAcceptAfterEdit = true;
    }
    if (isEdit && acceptAfterEdit && !confirmAcceptAfterEdit) {
        return {
            ok: false,
            code: "edit_accept_confirm_required",
            error: "编辑候选路径 A 须 confirm_accept_after_edit=true（确认：采纳本章编辑稿并验收为正式章）。禁止静默验收。",
            needEditConfirm: true,
            needConfirm: true,
        };
    }
    const r = await runAccept({
        paths,
        dir,
        workKey,
        candidateId,
        mode: req.mode === "append" ? "append" : "replace",
        force: Boolean(req.force),
        lintPassToken: req.lintPassToken,
        skipBrief: Boolean(req.skipBrief),
        strictLint: Boolean(req.strictLint),
        requirePayoff: Boolean(req.requirePayoff),
        strictHuman: Boolean(req.strictHuman),
        strictNovel: Boolean(req.strictNovel),
        acceptAfterEdit,
        confirmAcceptAfterEdit,
    });
    if (!r.ok)
        return { ok: false, code: r.code, error: r.error };
    return {
        ok: true,
        candidateId,
        chapterId: r.chapterId,
        title: r.title,
        wordCount: r.wordCount,
        status: r.status,
        receipt: r.receipt,
        nextHint: r.nextHint,
    };
}
