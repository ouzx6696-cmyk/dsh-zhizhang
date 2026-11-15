import { spawn } from "node:child_process";
import { AppError } from "../errors/app-error.js";

export interface PythonResult {
  stdout: string;
  stderr: string;
  code: number;
}

export function resolvePythonBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZHIZHANG_PYTHON?.trim() || "python3";
}

export async function runPythonScript(
  scriptPath: string,
  args: string[],
  opts?: { cwd?: string; stdin?: string; pythonBin?: string; timeoutMs?: number },
): Promise<PythonResult> {
  const bin = opts?.pythonBin ?? resolvePythonBin();
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [scriptPath, ...args], {
      cwd: opts?.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = opts?.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGKILL");
          reject(new AppError("python.failed", "Python 子进程执行超时", { scriptPath }));
        }, opts.timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(
        new AppError("python.unavailable", `无法启动 Python: ${err.message}`, {
          bin,
          scriptPath,
        }),
      );
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });

    if (opts?.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}

export async function runPythonJson<T>(
  scriptPath: string,
  args: string[],
  opts?: { cwd?: string; stdin?: string; pythonBin?: string; timeoutMs?: number },
): Promise<T> {
  const res = await runPythonScript(scriptPath, args, opts);
  if (res.code !== 0) {
    throw new AppError("python.failed", res.stderr.trim() || `Python exited with ${res.code}`, {
      code: res.code,
      stdout: res.stdout,
    });
  }
  try {
    return JSON.parse(res.stdout) as T;
  } catch (err) {
    throw new AppError("python.failed", "Python 输出不是合法 JSON", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}
