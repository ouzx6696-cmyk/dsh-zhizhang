/**
 * PayoffGate — soft-bind recent payoff audit; optional require_payoff hard refuse.
 */
import type { PayoffAuditStored } from "../types.js";
import { type GateDecision } from "./types.js";
export declare const PayoffGate: {
    evaluateAccept(opts: {
        payoff: PayoffAuditStored | null | undefined;
        requirePayoff: boolean;
    }): GateDecision;
};
