/**
 * 采纳管线 — tool / panel 共用一套硬闸与落盘。
 * 只负责「候选 → 当前工作稿 + 版本化接续索引」；不处理面板 confirm 文案，也不 openWork。
 */
import { acceptCandidate, candidateGateFingerprint, getRecentBrief, getRecentPayoffAudit, readCandidate, readChapter, } from "../work-store.js";
import { AcceptPolicy, FoundationPort, InspirationPort, Scheduler, firstDenyCode, firstDenyText, } from "../ports/index.js";
import { getPortConfig } from "../ports/config.js";
import { ZhizhangError } from "../errors.js";
import { fingerprint } from "../domain/lifecycle.js";
import { lintStyle } from "../style-linter.js";
import { resolvePrevBody } from "./chapter-context.js";
function errResult(err, fallback) {
    return {
        ok: false,
        code: err instanceof ZhizhangError ? err.code : fallback,
        error: err instanceof Error ? err.message : String(err),
    };
}
export async function runAccept(input) {
    const { paths, dir, workKey, candidateId, mode = "replace", lintPassToken, 
    // 所有确认/旁路旗标只认严格 true；字符串 "false" 不能打开覆盖或跳过闸。
    force = false, skipBrief = false, 
    // 四个严格开关不设解构默认：undefined 时由 AcceptPolicy 落到
    // PortConfig 的 defaultStrict*（默认 false 的解构会把配置彻底短路）。
    strictLint, requirePayoff, strictHuman, strictNovel, acceptAfterEdit = false, confirmAcceptAfterEdit = false, } = input;
    const forceFlag = force === true;
    const skipBriefFlag = skipBrief === true;
    const acceptAfterEditFlag = acceptAfterEdit === true;
    const confirmAcceptAfterEditFlag = confirmAcceptAfterEdit === true;
    let candMeta;
    try {
        candMeta = await readCandidate(dir, candidateId);
    }
    catch (err) {
        return errResult(err, "candidate_not_found");
    }
    // 留痕窗口走 PortConfig（默认 12h）：BriefGate 文案与实际查询必须同源。
    const recentMs = getPortConfig().briefRecentMs;
    const brief = await getRecentBrief(dir, candMeta.chapterId, recentMs);
    const currentChapter = await readChapter(dir, candMeta.chapterId);
    const payoffRecord = await getRecentPayoffAudit(dir, candMeta.chapterId, recentMs);
    const payoff = payoffRecord?.bodyHash === fingerprint(candMeta.body) && payoffRecord?.outlineHash === fingerprint(currentChapter.outline) ? payoffRecord : null;
    const craftCue = await InspirationPort.resolveCraftCue(paths, { workKey, limit: 5 });
    const prevBody = await resolvePrevBody(dir, candMeta.chapterId);
    const expectedCandidate = candidateGateFingerprint(candMeta);
    if (!candMeta.lintPassToken)
        candMeta.lintHitCount = lintStyle(candMeta.body).length;
    const gate = AcceptPolicy.evaluate({
        candidate: candMeta,
        brief,
        payoff,
        skipBrief: skipBriefFlag,
        strictLint,
        requirePayoff,
        strictHuman,
        strictNovel,
        prevBody,
        craftCue,
        acceptAfterEdit: acceptAfterEditFlag,
        confirmAcceptAfterEdit: confirmAcceptAfterEditFlag,
    });
    if (!gate.ok) {
        return { ok: false, code: firstDenyCode(gate), error: firstDenyText(gate) };
    }
    let saved;
    try {
        saved = await acceptCandidate(dir, candidateId, mode === "append" ? "append" : "replace", {
            force: forceFlag,
            expectedRevision: input.expectedRevision,
            expectedOutline: fingerprint(currentChapter.outline),
            expectedCandidate,
            lintPassToken: String(lintPassToken ?? "").trim() || undefined,
        });
    }
    catch (err) {
        return errResult(err, "accept_failed");
    }
    const state = saved.stateUpdate;
    const happenedLines = FoundationPort.acceptReceiptLines({
        threads: state.threads,
        endingVsBodyWarn: state.resolved.warn,
    });
    const receipt = [
        `已采纳 ${candidateId} →「${saved.title}」（${saved.id}），${saved.wordCount} 字，状态 ${saved.status}。仍需作者审校/定稿。`,
        "以下仅为机械诊断信号；有作用的心理、安静体验与完整收束可保留，不等于内容审读或定稿。",
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
