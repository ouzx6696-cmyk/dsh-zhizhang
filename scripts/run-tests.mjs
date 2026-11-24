import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const BASE_ENV = {
  ...process.env,
  PYTHONUTF8: "1",
  PYTHONIOENCODING: "utf-8",
};

function findPython() {
  const candidates =
    process.platform === "win32"
      ? [
          ...(process.env.ZHIZHANG_PYTHON ? [[process.env.ZHIZHANG_PYTHON]] : []),
          ["python"],
          ["py", "-3"],
          ["python3"],
        ]
      : [
          ...(process.env.ZHIZHANG_PYTHON ? [[process.env.ZHIZHANG_PYTHON]] : []),
          ["python3"],
          ["python"],
        ];
  for (const [cmd, ...prefix] of candidates) {
    const probe = spawnSync(cmd, [...prefix, "--version"], {
      stdio: "ignore",
      env: BASE_ENV,
    });
    if (probe.status === 0) return { cmd, prefix };
  }
  console.error("找不到可用的 Python 3（已尝试 ZHIZHANG_PYTHON、python3、python、py -3）");
  process.exit(1);
}

function runOrExit(cmd, args) {
  const res = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: BASE_ENV,
  });
  if (res.error) {
    console.error(`执行失败 (${cmd}): ${res.error.message}`);
    process.exit(1);
  }
  if ((res.status ?? 1) !== 0) {
    process.exit(res.status ?? 1);
  }
}

function listTests(relDir) {
  const full = path.join(ROOT, relDir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => path.join(relDir, name));
}

const py = findPython();
runOrExit(py.cmd, [
  ...py.prefix,
  "-m",
  "unittest",
  "discover",
  "-s",
  "packages/toutiao/skill/tests",
  "-p",
  "test_*.py",
]);
runOrExit(py.cmd, [
  ...py.prefix,
  "-m",
  "unittest",
  "discover",
  "-s",
  "packages/fanqie/skill/tests",
  "-p",
  "test_*.py",
]);

const nodeTests = [...listTests("test/unit"), ...listTests("test/engine")];
runOrExit(process.execPath, ["--test", ...nodeTests]);
