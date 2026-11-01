import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const python = process.env.WRITER_PYTHON || (process.platform === "win32" ? "python" : "python3");
const env = { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" };
const suites = [
  "packages/toutiao/skill/tests/test_gates.py",
  "packages/fanqie/skill/tests/test_bridge.py",
];
for (const suite of suites) {
  const result = spawnSync(python, [suite], { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
