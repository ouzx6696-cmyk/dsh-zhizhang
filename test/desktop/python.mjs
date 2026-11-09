import { spawnSync } from "node:child_process";

function usable(command) {
  const probe = spawnSync(
    command,
    ["-c", "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)"],
    { encoding: "utf8" },
  );
  return probe.status === 0;
}

function detect() {
  const explicit = process.env.WRITER_PYTHON?.trim();
  if (explicit) return explicit;
  const candidates =
    process.platform === "win32" ? ["python", "py", "python3"] : ["python3", "python"];
  for (const command of candidates) if (usable(command)) return command;
  throw new Error("找不到 Python 3.10+；请设置 WRITER_PYTHON");
}

export const PYTHON = detect();
