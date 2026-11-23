import { spawn } from "node:child_process";
import { AppError, isAppError } from "../errors/app-error.js";
import type { Parser } from "../schema/parse.js";

export const DEFAULT_PYTHON_TIMEOUT_MS = 30_000;
export const DEFAULT_PYTHON_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export interface PythonResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface PythonRunOptions {
  cwd?: string;
  stdin?: string;
  pythonBin?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface PythonExecutor {
  runScript(scriptPath: string, args: string[], opts?: PythonRunOptions): Promise<PythonResult>;
}

export function resolvePythonBin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.ZHIZHANG_PYTHON?.trim();
  if (configured) return configured;
  return process.platform === "win32" ? "python" : "python3";
}

export async function runPythonScript(
  scriptPath: string,
  args: string[],
  opts?: PythonRunOptions,
): Promise<PythonResult> {
  if (opts?.signal?.aborted) {
    throw new AppError("run.stopped", "Python 子进程执行已取消", { scriptPath });
  }
  const bin = opts?.pythonBin ?? resolvePythonBin();
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_PYTHON_TIMEOUT_MS;
  const maxOutputBytes = opts?.maxOutputBytes ?? DEFAULT_PYTHON_MAX_OUTPUT_BYTES;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, [scriptPath, ...args], {
      cwd: opts?.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
      },
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let outputBytes = 0;
    let settled = false;

    const killChild = () => {
      try {
        child.kill("SIGTERM");
        const force = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // 进程已退出
          }
        }, 500);
        force.unref?.();
      } catch {
        // 进程已退出
      }
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener("abort", onAbort);
    };

    const failWith = (err: AppError) => {
      if (settled) return;
      settled = true;
      cleanup();
      killChild();
      reject(err);
    };

    const onAbort = () => {
      failWith(new AppError("run.stopped", "Python 子进程执行已取消", { scriptPath }));
    };

    opts?.signal?.addEventListener("abort", onAbort, { once: true });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            failWith(
              new AppError("python.failed", "Python 子进程执行超时", {
                scriptPath,
                timeoutMs,
              }),
            );
          }, timeoutMs)
        : undefined;

    const append = (chunk: Buffer, target: "stdout" | "stderr") => {
      if (settled) return;
      outputBytes += chunk.byteLength;
      if (outputBytes > maxOutputBytes) {
        failWith(
          new AppError("python.failed", "Python 子进程输出超过大小限制", {
            scriptPath,
            maxOutputBytes,
          }),
        );
        return;
      }
      if (target === "stdout") stdoutChunks.push(chunk);
      else stderrChunks.push(chunk);
    };

    child.stdout.on("data", (chunk: Buffer) => append(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => append(chunk, "stderr"));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        new AppError("python.unavailable", `无法启动 Python: ${err.message}`, {
          bin,
          scriptPath,
        }),
      );
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        code: code ?? 1,
      });
    });

    if (opts?.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}

export const defaultPythonExecutor: PythonExecutor = {
  runScript: runPythonScript,
};

export async function runPythonJson<T>(
  scriptPath: string,
  args: string[],
  parser: Parser<T>,
  opts?: PythonRunOptions & { executor?: PythonExecutor },
): Promise<T> {
  const exec = opts?.executor ?? defaultPythonExecutor;
  const res = await exec.runScript(scriptPath, args, opts);
  if (res.code !== 0) {
    throw new AppError("python.failed", res.stderr.trim() || `Python exited with ${res.code}`, {
      code: res.code,
      stdout: res.stdout,
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(res.stdout);
  } catch (err) {
    throw new AppError("python.failed", "Python 输出不是合法 JSON", {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
  try {
    return parser(raw, "$");
  } catch (err) {
    if (isAppError(err)) {
      throw new AppError("python.failed", `Python 输出契约校验失败：${err.message}`, {
        scriptPath,
        cause: err.message,
      });
    }
    throw new AppError("python.failed", "Python 输出契约校验失败", { scriptPath });
  }
}
