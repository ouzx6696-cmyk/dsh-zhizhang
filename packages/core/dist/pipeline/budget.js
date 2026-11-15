import { AppError } from "../errors/app-error.js";
export function createBudgetGuard(config, initial) {
    let usedTokens = (initial?.input ?? 0) + (initial?.output ?? 0);
    let usedMoney = initial?.cost ?? 0;
    let inflightTokens = 0;
    return {
        reserve(estimatedTokens) {
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
            if (config.moneyCap !== null) {
                if (usedMoney === null) {
                    throw new AppError("budget.money", "服务商价格未知，无法校验金额上限");
                }
                if (usedMoney >= config.moneyCap) {
                    throw new AppError("budget.money", "任务金额上限已达到，已在阶段边界暂停", {
                        usedMoney,
                        moneyCap: config.moneyCap,
                    });
                }
            }
            inflightTokens += estimatedTokens;
        },
        settle(actual) {
            usedTokens += actual.input + actual.output;
            inflightTokens = Math.max(0, inflightTokens - actual.input);
            if (usedMoney === null || actual.cost === null) {
                usedMoney = null;
            }
            else {
                usedMoney += actual.cost;
            }
        },
        snapshot() {
            return { usedTokens, inflightTokens, usedMoney };
        },
    };
}
