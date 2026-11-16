import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const BASELINE_FILE = path.join(ROOT, "scripts", "any-baseline.json");

export function evaluateRatchet(metrics, baseline) {
  const failures = [];
  const checks = [
    ["any", metrics.any, baseline.any - 1],
    ["nonNull", metrics.nonNull, baseline.nonNull],
    ["nonNullDefinite", metrics.nonNullDefinite, baseline.nonNullDefinite ?? baseline.nonNull],
    ["as", metrics.as, baseline.as],
    ["mainRawError", metrics.mainRawError, baseline.mainRawError],
    ["unusedExports", metrics.unusedExports, baseline.unusedExports],
  ];
  for (const [name, actual, limit] of checks) {
    if (!Number.isFinite(actual) || !Number.isFinite(limit) || actual > limit) {
      failures.push(`${name}: ${actual} > ${limit}`);
    }
  }
  return failures;
}

export function parseGuardMetrics(output) {
  const type = /\[G-type\] any=(\d+), !=(\d+), !=:(\d+), as=(\d+)/.exec(output);
  const main = /\[G-error\] main=(\d+)/.exec(output);
  const unused = /\[G-exports\] unused=(\d+)/.exec(output);
  if (!type || !main || !unused) throw new Error("无法解析 guard.mjs 的计数输出");
  return {
    any: Number(type[1]),
    nonNull: Number(type[2]),
    nonNullDefinite: Number(type[3]),
    as: Number(type[4]),
    mainRawError: Number(main[1]),
    unusedExports: Number(unused[1]),
  };
}

function main() {
  const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  const guard = spawnSync(process.execPath, [path.join(ROOT, "scripts", "guard.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  if (guard.status !== 0) {
    process.stdout.write(guard.stdout ?? "");
    process.stderr.write(guard.stderr ?? "");
    throw new Error("guard.mjs 未通过，无法执行棘轮判定");
  }
  const metrics = parseGuardMetrics(guard.stdout);
  const failures = evaluateRatchet(metrics, baseline);
  console.log(
    `[G-ratchet] any=${metrics.any}/${baseline.any - 1} nonNull=${metrics.nonNull}/${baseline.nonNull} as=${metrics.as}/${baseline.as} mainRaw=${metrics.mainRawError}/${baseline.mainRawError} unused=${metrics.unusedExports}/${baseline.unusedExports}`,
  );
  if (failures.length) throw new Error(`基线棘轮未通过：${failures.join("；")}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
