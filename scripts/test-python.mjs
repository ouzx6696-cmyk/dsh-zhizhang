import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.WRITER_PYTHON || (process.platform === "win32" ? "python" : "python3");
const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
// Discovered rather than listed, so a new tests/test_*.py cannot silently stay out of verify.
const suites = globSync("packages/*/skill/tests/test_*.py", { cwd: root }).sort();
if (suites.length === 0) throw new Error("没有找到 Python 测试：packages/*/skill/tests/test_*.py");
for (const suite of suites) {
  const result = spawnSync(python, [suite], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
