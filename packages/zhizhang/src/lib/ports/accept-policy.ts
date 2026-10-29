import { BriefGate } from "./brief-gate.js";
import { LintGate } from "./lint-gate.js";
import { PayoffGate } from "./payoff-gate.js";
import { HumanFeelGate } from "./human-feel-gate.js";
import { NovelSenseGate } from "./novel-sense-gate.js";
import { getPortConfig } from "./config.js";
import { EditPort } from "./edit.js";
import { allow, formatGateMessages, mergeDecisions, } from "./types.js";
/** 这些 info 码的正文自带完整语义，回执直接用文本、不带 code 前缀。 */
const RECEIPT_TEXT_ONLY = new Set([
    "brief_ok",
    "payoff_ok",
    "human_feel_ok",
    "novel_sense_ok",
    "edit_accept_confirmed",
]);
export const AcceptPolicy = {
    evaluate(input: any) {
        const cfg = getPortConfig();
        const skipBrief = input.skipBrief === true;
        const strictLint = input.strictLint ?? cfg.defaultStrictLint;
        const requirePayoff = input.requirePayoff ?? cfg.defaultRequirePayoff;
        const strictHuman = input.strictHuman ?? cfg.defaultStrictHuman;
        const strictNovel = input.strictNovel ?? cfg.defaultStrictNovel;
        const hitCount = LintGate.hitCountOf(input.candidate);
        const briefD = BriefGate.evaluateAccept({ brief: input.brief, skipBrief });
        const lintD = LintGate.evaluateAccept({ hitCount, strictLint });
        const payoffD = PayoffGate.evaluateAccept({ payoff: input.payoff, requirePayoff });
        const editD = EditPort.evaluateAcceptFlags({
            acceptAfterEdit: input.acceptAfterEdit,
            confirmAcceptAfterEdit: input.confirmAcceptAfterEdit,
            candidateIsEdit: Boolean(input.candidate.editOf),
        });
        // 便宜的门先评；一旦已有硬拒，跳过人味/书感两次全文扫描——
        // 反正 runAccept 只取第一条 error，回执在 deny 时也不会被使用。
        const cheapOk = briefD.ok && lintD.ok && payoffD.ok && editD.ok;
        const humanD = cheapOk
            ? HumanFeelGate.evaluateAccept({
                body: input.candidate.body ?? "",
                strictHuman,
                craftCue: input.craftCue,
            })
            : allow([]);
        const novelD = cheapOk
            ? NovelSenseGate.evaluateAccept({
                body: input.candidate.body ?? "",
                prevBody: input.prevBody,
                strictNovel,
            })
            : allow([]);
        const merged = mergeDecisions(briefD, lintD, payoffD, humanD, novelD, editD);
        const receiptLines = [...LintGate.echoLines(hitCount)];
        // Soft/info messages always useful on success; on deny, tool shows error via fail().
        for (const m of softAndInfo(merged.messages)) {
            receiptLines.push(...formatGateMessages([m], { textOnlyInfo: RECEIPT_TEXT_ONLY }));
        }
        if (merged.ok &&
            input.acceptAfterEdit === true &&
            input.confirmAcceptAfterEdit === true &&
            input.candidate.editOf) {
            receiptLines.push(...EditPort.acceptPathAReceiptLines());
        }
        return { ...merged, hitCount, receiptLines };
    },
};
function softAndInfo(messages: any) {
    return messages.filter((m: any) => m.severity !== "error");
}
/** First hard-error code for ZhizhangError. */
export function firstDenyCode(decision: any) {
    const err = decision.messages.find((m: any) => m.severity === "error");
    return err?.code ?? "gate_denied";
}
export function firstDenyText(decision: any) {
    const err = decision.messages.find((m: any) => m.severity === "error");
    return err?.text ?? "拒绝";
}
