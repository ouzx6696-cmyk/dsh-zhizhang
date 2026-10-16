/**
 * PayoffGate — soft-bind recent payoff audit; optional require_payoff hard refuse.
 */
import type { PayoffAuditStored } from "../types.js";
import { allow, deny, warn, info, type GateDecision } from "./types.js";

export const PayoffGate = {
  evaluateAccept(opts: {
    payoff: PayoffAuditStored | null | undefined;
    requirePayoff: boolean;
  }): GateDecision {
    const { payoff, requirePayoff } = opts;
    if (requirePayoff) {
      if (!payoff) {
        return deny(
          "payoff_missing",
          `require_payoff=true：本章无近期 zhizhang_payoff_audit。请先审计，或关闭 require_payoff（默认仅警告 payoff_missing）。`,
        );
      }
      if (!payoff.ok) {
        return deny(
          "payoff_not_ok",
          `require_payoff=true：最近兑付审计未通过（${payoff.summary}）。请改稿或关闭 require_payoff（默认仅警告 payoff_not_ok）。`,
        );
      }
    }
    if (!payoff) {
      return allow([
        warn(
          "payoff_missing",
          `本章无近期 zhizhang_payoff_audit（软提示）。默认链不强制；accept 已看 ending。细诊再跑 payoff_audit；require_payoff=true 才硬拒。`,
        ),
      ]);
    }
    if (!payoff.ok) {
      return allow([
        warn("payoff_not_ok", `最近兑付审计未通过：${payoff.summary}`),
      ]);
    }
    return allow([info("payoff_ok", `payoff 审计：ok · ${payoff.at}`)]);
  },
};
