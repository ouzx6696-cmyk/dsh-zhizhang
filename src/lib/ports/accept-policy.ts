// @ts-nocheck
import { BriefGate } from "./brief-gate.js";
import { LintGate } from "./lint-gate.js";
import { PayoffGate } from "./payoff-gate.js";
import { HumanFeelGate } from "./human-feel-gate.js";
import { NovelSenseGate } from "./novel-sense-gate.js";
import { getPortConfig } from "./config.js";
import { EditPort } from "./edit.js";
import { formatGateMessages, mergeDecisions, } from "./types.js";
export const AcceptPolicy = {
    evaluate(input) {
        const cfg = getPortConfig();
        const skipBrief = Boolean(input.skipBrief);
        const strictLint = input.strictLint ?? cfg.defaultStrictLint;
        const requirePayoff = input.requirePayoff ?? cfg.defaultRequirePayoff;
        const strictHuman = input.strictHuman ?? cfg.defaultStrictHuman;
        const strictNovel = input.strictNovel ?? cfg.defaultStrictNovel;
        const hitCount = LintGate.hitCountOf(input.candidate);
        const briefD = BriefGate.evaluateAccept({ brief: input.brief, skipBrief });
        const lintD = LintGate.evaluateAccept({ hitCount, strictLint });
        const payoffD = PayoffGate.evaluateAccept({ payoff: input.payoff, requirePayoff });
        const humanD = HumanFeelGate.evaluateAccept({
            body: input.candidate.body ?? "",
            strictHuman,
            craftCue: input.craftCue,
        });
        const novelD = NovelSenseGate.evaluateAccept({
            body: input.candidate.body ?? "",
            prevBody: input.prevBody,
            strictNovel,
        });
        const editD = EditPort.evaluateAcceptFlags({
            acceptAfterEdit: input.acceptAfterEdit,
            confirmAcceptAfterEdit: input.confirmAcceptAfterEdit,
            candidateIsEdit: Boolean(input.candidate.editOf),
        });
        const merged = mergeDecisions(briefD, lintD, payoffD, humanD, novelD, editD);
        const receiptLines = [...LintGate.echoLines(hitCount)];
        // Soft/info messages always useful on success; on deny, tool shows error via fail().
        for (const m of softAndInfo(merged.messages)) {
            receiptLines.push(...formatGateMessages([m]));
        }
        // brief_ok / payoff_ok already formatted as "code：text" via info — normalize brief/payoff info to plain lines tests expect
        normalizeReceipt(receiptLines);
        if (merged.ok &&
            input.acceptAfterEdit &&
            input.confirmAcceptAfterEdit &&
            input.candidate.editOf) {
            receiptLines.push(...EditPort.acceptPathAReceiptLines());
        }
        return { ...merged, hitCount, receiptLines };
    },
};
function softAndInfo(messages) {
    return messages.filter((m) => m.severity !== "error");
}
/** Match existing tool receipt phrasing expected by tests. */
function normalizeReceipt(lines) {
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // info brief_ok was "brief_ok：..."
        if (line.startsWith("brief_ok：")) {
            lines[i] = line.slice("brief_ok：".length);
        }
        if (line.startsWith("payoff_ok：")) {
            lines[i] = line.slice("payoff_ok：".length);
        }
        if (line.startsWith("human_feel_ok：")) {
            lines[i] = line.slice("human_feel_ok：".length);
        }
        if (line.startsWith("novel_sense_ok：")) {
            lines[i] = line.slice("novel_sense_ok：".length);
        }
        if (line.startsWith("edit_accept_confirmed：")) {
            lines[i] = line.slice("edit_accept_confirmed：".length);
        }
        if (line.startsWith("save_meta_only：") || line.startsWith("save_bypass_confirmed：")) {
            // unused on accept
        }
    }
}
/** First hard-error code for ZhizhangError. */
export function firstDenyCode(decision) {
    const err = decision.messages.find((m) => m.severity === "error");
    return err?.code ?? "gate_denied";
}
export function firstDenyText(decision) {
    const err = decision.messages.find((m) => m.severity === "error");
    return err?.text ?? "拒绝";
}
