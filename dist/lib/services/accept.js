/**
 * 采纳管线 — tool / panel 共用一套硬闸与落盘。
 * 只负责「候选 → 正式章 + happened」；不处理面板 confirm 文案，也不 openWork。
 */
import { acceptCandidate, getRecentBrief, getRecentPayoffAudit, readCandidate, readChapter, readWorkMeta, } from "../store.js";
import { AcceptPolicy, FoundationPort, InspirationPort, Scheduler, firstDenyCode, firstDenyText, } from "../ports/index.js";
import { ZhizhangError } from "../errors.js";
import { resolvePrevBody } from "./chapter-context.js";
function errResult(err, fallback) {
    return {
        ok: false,
        code: err instanceof ZhizhangError ? err.code : fallback,
        error: err instanceof Error ? err.message : String(err),
    };
}
export async function runAccept(input) {
    const { paths, dir, workKey, candidateId, mode = "replace", force = false, lintPassToken, skipBrief = false, strictLint = false, requirePayoff = false, strictHuman = false, strictNovel = false, acceptAfterEdit = false, confirmAcceptAfterEdit = false, } = input;
    let candMeta;
    try {
        candMeta = await readCandidate(dir, candidateId);
    }
    catch (err) {
        return errResult(err, "candidate_not_found");
    }
    const brief = await getRecentBrief(dir, candMeta.chapterId);
    const payoff = await getRecentPayoffAudit(dir, candMeta.chapterId);
    const craftCue = await InspirationPort.resolveCraftCue(paths, { workKey, limit: 5 });
    const prevBody = await resolvePrevBody(dir, candMeta.chapterId);
    const gate = AcceptPolicy.evaluate({
        candidate: candMeta,
        brief,
        payoff,
        skipBrief,
        strictLint,
        requirePayoff,
        strictHuman,
        strictNovel,
        prevBody,
        craftCue,
        acceptAfterEdit,
        confirmAcceptAfterEdit,
    });
    if (!gate.ok) {
        return { ok: false, code: firstDenyCode(gate), error: firstDenyText(gate) };
    }
    let saved;
    try {
        saved = await acceptCandidate(dir, candidateId, mode === "append" ? "append" : "replace", {
            force,
            lintPassToken: String(lintPassToken ?? "").trim() || undefined,
        });
    }
    catch (err) {
        return errResult(err, "accept_failed");
    }
    let ending = "";
    let body = "";
    try {
        const ch = await readChapter(dir, saved.id);
        ending = ch.outline.ending || "";
        body = ch.body || "";
    }
    catch {
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
