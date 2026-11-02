import { styleLint } from "./audit/style-lint.js";
import { reviewLedger } from "./audit/review-ledger.js";
import { payoffAudit } from "./audit/payoff-audit.js";
import { humanFeelAudit } from "./audit/human-feel-audit.js";
import { novelSenseAudit } from "./audit/novel-sense-audit.js";
export function auditTools() {
  return [styleLint, reviewLedger, payoffAudit, humanFeelAudit, novelSenseAudit];
}
