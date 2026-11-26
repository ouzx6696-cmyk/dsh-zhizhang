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

  const request = guard.reserve(600);
  assert.deepEqual(guard.snapshot(), { usedTokens: 0, inflightTokens: 600, usedMoney: 0 });

  request.settle({ input: 500, cachedInput: 0, output: 300, cost: 0.25 });
  assert.deepEqual(guard.snapshot(), { usedTokens: 800, inflightTokens: 0, usedMoney: 0.25 });
  const pending = guard.reserve(200);
  guard.reserve(100).settle({ input: 150, cachedInput: 20, output: 0, cost: 0 });
  assert.equal(guard.snapshot().inflightTokens, 200);
  pending.release();
  assert.equal(guard.snapshot().inflightTokens, 0);
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

  guard.reserve(400).settle({ input: 400, cachedInput: 0, output: 300, cost: 0.3 });

  assert.throws(
    () => guard.reserve(400),
    (err) => isAppError(err, "budget.tokens"),
  );

  const moneyGuard = createBudgetGuard({
    inputBudget: 500,
    runBudget: 5000,
    moneyCap: 0.5,
  });
  moneyGuard.reserve(100).settle({ input: 100, cachedInput: 0, output: 50, cost: 0.5 });
  assert.throws(
    () => moneyGuard.reserve(100),
    (err) => isAppError(err, "budget.money"),
  );

  const unknownCostGuard = createBudgetGuard({
    inputBudget: 500,
    runBudget: 5000,
    moneyCap: 1.0,
  });
  unknownCostGuard.reserve(100).settle({ input: 100, cachedInput: 0, output: 50, cost: null });
  assert.throws(
    () => unknownCostGuard.reserve(100),
    (err) => isAppError(err, "budget.money"),
  );
});

test("R5 (F18): budget guard tracks inflight estimated money to prevent concurrent overspend", () => {
  const guard = createBudgetGuard({
    inputBudget: 1000,
    runBudget: 5000,
    moneyCap: 0.1,
  });

  const r1 = guard.reserve(200, 0.06);
  assert.throws(
    () => guard.reserve(200, 0.06),
    (err) => isAppError(err, "budget.money"),
  );
  r1.release();

  const r2 = guard.reserve(200, 0.06);
  r2.settle({ input: 200, cachedInput: 0, output: 100, cost: 0.04 });
  assert.equal(guard.snapshot().usedMoney, 0.04);
});
