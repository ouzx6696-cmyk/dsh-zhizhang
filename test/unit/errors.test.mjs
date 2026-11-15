import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { AppError, isAppError, serializeError, classify, CODES } = await importTs(
  "packages/core/src/errors/index.ts",
);

test("AppError preserves code, message, data, and spec", () => {
  const err = new AppError("budget.tokens", "token exhausted", { used: 100 });
  assert.equal(err.name, "AppError");
  assert.equal(err.code, "budget.tokens");
  assert.deepEqual(err.data, { used: 100 });
  assert.deepEqual(err.spec, CODES["budget.tokens"]);
  assert.equal(isAppError(err), true);
  assert.equal(isAppError(err, "budget.tokens"), true);
  assert.equal(isAppError(err, "model.auth"), false);
  assert.deepEqual(serializeError(err), {
    code: "budget.tokens",
    message: "token exhausted",
    data: { used: 100 },
  });
});

test("classify maps AbortError, errno codes, HTTP statuses, and provider hints", () => {
  const existing = new AppError("gate.denied", "denied");
  assert.equal(classify(existing), existing);

  const aborted = classify(Object.assign(new Error("aborted"), { name: "AbortError" }));
  assert.equal(aborted.code, "run.stopped");

  assert.equal(classify({ code: "ENOENT", message: "missing" }).code, "input.not_found");
  assert.equal(classify({ code: "EBUSY", message: "busy" }).code, "storage.locked");
  assert.equal(classify({ code: "EACCES", message: "perm" }).code, "storage.io");
  assert.equal(classify({ code: "ECONNREFUSED", message: "refused" }).code, "network.proxy");
  assert.equal(classify({ code: "ETIMEDOUT", message: "timeout" }).code, "model.unavailable");

  assert.equal(classify({ status: 401, message: "unauth" }).code, "model.auth");
  assert.equal(classify({ status: 402, message: "pay" }).code, "model.balance");
  assert.equal(classify({ status: 413, message: "large" }).code, "model.context_overflow");
  assert.equal(classify({ statusCode: 429, message: "limit" }).code, "model.rate_limited");
  assert.equal(classify({ status: 503, message: "down" }).code, "model.unavailable");

  assert.equal(classify(new Error("boom"), { provider: true }).code, "model.unavailable");
  assert.equal(classify("raw string").code, "internal");
});
