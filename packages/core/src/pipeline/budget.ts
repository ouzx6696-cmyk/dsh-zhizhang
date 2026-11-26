import { AppError } from "../errors/app-error.js";
import type { BudgetConfig, UsageTotals } from "./record.js";

export interface BudgetGuard {
  reserve(
    estimatedTokens: number,
    estimatedCost?: number | null,
  ): {
    settle(actual: UsageTotals): void;
    release(): void;
  };
  snapshot(): { usedTokens: number; inflightTokens: number; usedMoney: number | null };
}

export function createBudgetGuard(config: BudgetConfig, initial?: UsageTotals): BudgetGuard {
  let usedTokens = (initial?.input ?? 0) + (initial?.cachedInput ?? 0) + (initial?.output ?? 0);
  let usedMoney: number | null = initial ? initial.cost : 0;
  let inflightTokens = 0;
  let inflightMoney = 0;

  return {
    reserve(estimatedTokens: number, estimatedCost?: number | null) {
      if (estimatedTokens > config.inputBudget) {
        throw new AppError("model.context_overflow", "单阶段估算输入超出 inputBudget", {
          estimatedTokens,
          inputBudget: config.inputBudget,
        });
      }
      if (usedTokens + inflightTokens + estimatedTokens > config.runBudget) {
        throw new AppError("budget.tokens", "任务 token 预算已用尽，已在阶段边界暂停", {
          usedTokens,
          inflightTokens,
          estimatedTokens,
          runBudget: config.runBudget,
        });
      }
      const reservedCost =
        typeof estimatedCost === "number" && Number.isFinite(estimatedCost) && estimatedCost > 0
          ? estimatedCost
          : 0;
      if (config.moneyCap !== null) {
        if (usedMoney === null) {
          throw new AppError("budget.money", "服务商价格未知，无法校验金额上限");
        }
        const projectedMoney = usedMoney + inflightMoney + reservedCost;
        if (
          usedMoney + inflightMoney >= config.moneyCap ||
          (reservedCost > 0 && projectedMoney > config.moneyCap)
        ) {
          throw new AppError("budget.money", "任务金额上限已达到，已在阶段边界暂停", {
            usedMoney,
            inflightMoney,
            estimatedCost: reservedCost,
            moneyCap: config.moneyCap,
          });
        }
      }
      inflightTokens += estimatedTokens;
      inflightMoney += reservedCost;
      let heldTokens = estimatedTokens;
      let heldMoney = reservedCost;
      const release = () => {
        inflightTokens -= heldTokens;
        inflightMoney = Math.max(0, inflightMoney - heldMoney);
        heldTokens = 0;
        heldMoney = 0;
      };
      return {
        release,
        settle(actual) {
          release();
          usedTokens += actual.input + actual.cachedInput + actual.output;
          usedMoney = usedMoney === null || actual.cost === null ? null : usedMoney + actual.cost;
        },
      };
    },

    snapshot() {
      return { usedTokens, inflightTokens, usedMoney };
    },
  };
}
