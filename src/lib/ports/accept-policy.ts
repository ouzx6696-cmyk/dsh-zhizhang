/**
 * AcceptPolicy — compose Brief → Lint → Payoff → HumanFeel → NovelSense
 * (quality surface: style token + payoff + feel/poison + book) before store acceptCandidate.
 * Tools must call this instead of inlining gate ifs.
 */
import type { BriefBreadcrumb, CandidateFile, PayoffAuditStored } from "../types.js";
import { BriefGate } from "./brief-gate.js";
import { LintGate } from "./lint-gate.js";
import { PayoffGate } from "./payoff-gate.js";
import { HumanFeelGate } from "./human-feel-gate.js";
import { NovelSenseGate } from "./novel-sense-gate.js";
import { getPortConfig } from "./config.js";
import { EditPort } from "./edit.js";
import {
  formatGateMessages,
  mergeDecisions,
  type GateDecision,
  type GateMessage,
} from "./types.js";

export interface AcceptPolicyInput {
  candidate: CandidateFile;
  brief: BriefBreadcrumb | null | undefined;
  payoff: PayoffAuditStored | null | undefined;
  skipBrief?: boolean;
  strictLint?: boolean;
  requirePayoff?: boolean;
  /** Soft human-feel radar; default from PortConfig (false). */
  strictHuman?: boolean;
  /** Soft novel-sense radar; default from PortConfig (false). */
  strictNovel?: boolean;
  /** Previous chapter body for isomorphic re-demo check (optional). */
  prevBody?: string | null;
  /** Craft humanFeel blob; enables stiffness_tidy when shatter cues present. */
  craftCue?: string | null;
  /** Path A: accept this edit result as formal chapter (requires confirm). */
  acceptAfterEdit?: boolean;
  /** Path A one-shot confirm — never silent. */
  confirmAcceptAfterEdit?: boolean;
}

export interface AcceptGateResult extends GateDecision {
  hitCount: number;
  /** Lines to append after successful accept (echo + soft warns / info). */
  receiptLines: string[];
}

export const AcceptPolicy = {
  evaluate(input: AcceptPolicyInput): AcceptGateResult {
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
    const receiptLines: string[] = [...LintGate.echoLines(hitCount)];

    // Soft/info messages always useful on success; on deny, tool shows error via fail().
    for (const m of softAndInfo(merged.messages)) {
      receiptLines.push(...formatGateMessages([m]));
    }
    // brief_ok / payoff_ok already formatted as "code：text" via info — normalize brief/payoff info to plain lines tests expect
    normalizeReceipt(receiptLines);

    if (
      merged.ok &&
      input.acceptAfterEdit &&
      input.confirmAcceptAfterEdit &&
      input.candidate.editOf
    ) {
      receiptLines.push(...EditPort.acceptPathAReceiptLines());
    }

    return { ...merged, hitCount, receiptLines };
  },
};

function softAndInfo(messages: GateMessage[]): GateMessage[] {
  return messages.filter((m) => m.severity !== "error");
}

/** Match existing tool receipt phrasing expected by tests. */
function normalizeReceipt(lines: string[]): void {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
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
export function firstDenyCode(decision: GateDecision): string {
  const err = decision.messages.find((m) => m.severity === "error");
  return err?.code ?? "gate_denied";
}

export function firstDenyText(decision: GateDecision): string {
  const err = decision.messages.find((m) => m.severity === "error");
  return err?.text ?? "拒绝";
}
