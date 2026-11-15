import type { BudgetConfig, UsageTotals } from "./record.js";
export interface BudgetGuard {
    reserve(estimatedTokens: number): void;
    settle(actual: UsageTotals): void;
    snapshot(): {
        usedTokens: number;
        inflightTokens: number;
        usedMoney: number | null;
    };
}
export declare function createBudgetGuard(config: BudgetConfig, initial?: UsageTotals): BudgetGuard;
//# sourceMappingURL=budget.d.ts.map