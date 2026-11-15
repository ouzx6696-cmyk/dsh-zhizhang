import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { createBudgetGuard } = await importTs("packages/core/src/pipeline/budget.ts");
const { isAppError } = await importTs("packages/core/src/errors/index.ts");

test("budget guard tracks reserve and settle across stages", () => {
  const guard = createBudgetGuard({
    inputBudget: 1000,
    runBudget: 2500,
    moneyCap: 1.0,
  });

  guard.reserve(600);
  assert.deepEqual(guard.snapshot(), { usedTokens: 0, inflightTokens: 600, usedMoney: 0 });

  guard.settle({ input: 500, cachedInput: 0, output: 300, cost: 0.25 });
  assert.deepEqual(guard.snapshot(), { usedTokens: 800, inflightTokens: 100, usedMoney: 0.25 });
});

test("budget guard enforces inputBudget, runBudget, and moneyCap boundaries", () => {
  const guard = createBudgetGuard({
    inputBudget: 500,
    runBudget: 1000,
    moneyCap: 0.5,
  });

  assert.throws(
    () => guard.reserve(501),
    (err) => isAppError(err, "model.context_overflow"),
  );

  guard.reserve(400);
  guard.settle({ input: 400, cachedInput: 0, output: 300, cost: 0.3 });

  assert.throws(
    () => guard.reserve(400),
    (err) => isAppError(err, "budget.tokens"),
  );

  const moneyGuard = createBudgetGuard({
    inputBudget: 500,
    runBudget: 5000,
    moneyCap: 0.5,
  });
  moneyGuard.reserve(100);
  moneyGuard.settle({ input: 100, cachedInput: 0, output: 50, cost: 0.5 });
  assert.throws(
    () => moneyGuard.reserve(100),
    (err) => isAppError(err, "budget.money"),
  );

  const unknownCostGuard = createBudgetGuard({
    inputBudget: 500,
    runBudget: 5000,
    moneyCap: 1.0,
  });
  unknownCostGuard.reserve(100);
  unknownCostGuard.settle({ input: 100, cachedInput: 0, output: 50, cost: null });
  assert.throws(
    () => unknownCostGuard.reserve(100),
    (err) => isAppError(err, "budget.money"),
  );
});
