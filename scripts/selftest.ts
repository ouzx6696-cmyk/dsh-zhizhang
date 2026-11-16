import assert from "node:assert/strict";
import { budgets, evaluateBudget, evaluateSizePolicy, physicalLines } from "./check-budget.mjs";
import { evaluateRatchet, parseGuardMetrics } from "./check-ratchet.mjs";

const baseline = {
  any: 1,
  nonNull: 0,
  nonNullDefinite: 0,
  as: 258,
  mainRawError: 4,
  unusedExports: 36,
};
const passing = {
  any: 0,
  nonNull: 0,
  nonNullDefinite: 0,
  as: 166,
  mainRawError: 0,
  unusedExports: 21,
};
assert.deepEqual(evaluateRatchet(passing, baseline), []);
assert.equal(evaluateRatchet({ ...passing, any: 1 }, baseline).length, 1);
assert.equal(evaluateRatchet({ ...passing, as: 259 }, baseline).length, 1);
assert.deepEqual(
  parseGuardMetrics("[G-type] any=0, !=0, !=:0, as=166 | [G-error] main=0 | [G-exports] unused=21"),
  passing,
);

assert.deepEqual(evaluateBudget({ baseline: 10, current: 10, limit: 10 }), []);
assert.equal(evaluateBudget({ baseline: 11, current: 10, limit: 10 }).length, 1);
assert.equal(evaluateBudget({ baseline: 10, current: 11, limit: 10 }).length, 1);
assert.equal(physicalLines(""), 1);
assert.equal(physicalLines("a\n\nb\n"), 4);
assert.equal(physicalLines("a\r\nb"), 2);

assert.deepEqual(
  evaluateSizePolicy({ file: "new/file.ts", current: 400, isNew: true, isChanged: true }).failures,
  [],
);
assert.equal(
  evaluateSizePolicy({ file: "new/file.ts", current: 401, isNew: true, isChanged: true }).failures
    .length,
  1,
);
assert.deepEqual(
  evaluateSizePolicy({
    file: "apps/desktop/src/main/main.ts",
    current: 1510,
    isNew: false,
    isChanged: false,
  }).failures,
  [],
);
assert.equal(
  evaluateSizePolicy({
    file: "apps/desktop/src/main/main.ts",
    current: 1510,
    isNew: false,
    isChanged: true,
  }).failures.length,
  1,
);
assert.deepEqual(
  evaluateSizePolicy({
    file: "apps/desktop/src/main/main.ts",
    current: 1490,
    isNew: false,
    isChanged: true,
  }).failures,
  [],
);

for (const budget of budgets) {
  assert.ok(budget.limit > 0, `${budget.name} 缺少有效预算`);
  assert.equal(typeof budget.file, "string");
}

console.log("quality-gate selftest passed");
