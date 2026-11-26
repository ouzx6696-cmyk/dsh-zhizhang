import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function listTests(relDir) {
  const full = path.join(ROOT, relDir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join(relDir, name));
}

const unitTests = listTests("test/unit");
const engineTests = listTests("test/engine");
const allTests = [...unitTests, ...engineTests];

if (allTests.length === 0) {
  console.error("未发现任何自动化测试文件（test/unit/*.test.mjs 或 test/engine/*.test.mjs）");
  process.exit(1);
}

console.log(
  `运行自动化测试：单元测试 ${unitTests.length} 份，引擎集成测试 ${engineTests.length} 份`,
);

const res = spawnSync(process.execPath, ["--test", ...allTests], {
  cwd: ROOT,
  stdio: "inherit",
  env: process.env,
});

if (res.error) {
  console.error(`执行失败 (${process.execPath}): ${res.error.message}`);
  process.exit(1);
}
process.exit(res.status ?? 1);
