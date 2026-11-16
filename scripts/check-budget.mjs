import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");

export const SIZE_BASELINES = Object.freeze({
  "apps/desktop/src/main/main.ts": 1510,
  "apps/desktop/src/session/pi-adapter.ts": 1050,
  "packages/core/src/pipeline/runner.ts": 640,
});

export const budgets = Object.freeze([
  {
    name: "session/manager.ts",
    file: "apps/desktop/src/session/manager.ts",
    baseline: 495,
    limit: 600,
  },
  {
    name: "session/pi-adapter.ts",
    file: "apps/desktop/src/session/pi-adapter.ts",
    baseline: 396,
    limit: 600,
  },
  {
    name: "workbench/client legacy chunk",
    file: "packages/workbench/src/client/legacy",
    baseline: 0,
    limit: 600,
    optionalUntil: "U-01",
  },
]);

export function physicalLines(text) {
  return text.replace(/\r\n/g, "\n").split("\n").length;
}

export function evaluateBudget({ baseline, current, limit }) {
  const failures = [];
  if (baseline > limit) failures.push(`基线 ${baseline} > 预算 ${limit}`);
  if (current > limit) failures.push(`当前 ${current} > 预算 ${limit}`);
  return failures;
}

export function evaluateSizePolicy({ file, current, isNew, isChanged }) {
  const baseline = SIZE_BASELINES[file];
  if (baseline !== undefined) {
    const limit = isChanged ? baseline - 20 : baseline;
    return {
      baseline,
      target: baseline - 20,
      limit,
      failures: current > limit ? [`${file}: ${current} > ${limit}`] : [],
    };
  }
  return {
    baseline: null,
    target: 400,
    limit: isNew ? 400 : null,
    failures: isNew && current > 400 ? [`${file}: ${current} > 400（新增文件）`] : [],
  };
}

function chunkLines(absolutePath) {
  if (!fs.existsSync(absolutePath)) return null;
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return physicalLines(fs.readFileSync(absolutePath, "utf8"));
  const files = fs
    .readdirSync(absolutePath, { recursive: true })
    .filter((file) => /\.(?:[cm]?js|tsx?|jsx)$/.test(String(file)));
  return files.reduce(
    (total, file) => total + physicalLines(fs.readFileSync(path.join(absolutePath, file), "utf8")),
    0,
  );
}

function main() {
  let failed = false;
  for (const budget of budgets) {
    const current = chunkLines(path.join(ROOT, budget.file));
    if (current === null && budget.optionalUntil) {
      console.log(
        `[G-budget] ${budget.name}: pending(${budget.optionalUntil}) limit=${budget.limit}`,
      );
      continue;
    }
    if (current === null) throw new Error(`体积预算文件不存在：${budget.file}`);
    const failures = evaluateBudget({ ...budget, current });
    console.log(
      `[G-budget] ${budget.name}: baseline=${budget.baseline} current=${current} limit=${budget.limit}`,
    );
    for (const failure of failures) console.error(`  - ${failure}`);
    failed ||= failures.length > 0;
  }
  if (failed) throw new Error("体积预算未通过");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
