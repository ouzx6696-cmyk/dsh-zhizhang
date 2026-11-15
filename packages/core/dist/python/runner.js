import { spawn } from "node:child_process";
import { AppError } from "../errors/app-error.js";
export function resolvePythonBin(env = process.env) {
    return env.ZHIZHANG_PYTHON?.trim() || "python3";
}
export async function runPythonScript(scriptPath, args, opts) {
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
        child.stdout.on("data", (chunk) => {
            stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
            stderr += chunk.toString("utf8");
        });
        child.on("error", (err) => {
            if (timer)
                clearTimeout(timer);
            reject(new AppError("python.unavailable", `无法启动 Python: ${err.message}`, {
                bin,
                scriptPath,
            }));
        });
        child.on("close", (code) => {
            if (timer)
                clearTimeout(timer);
            resolve({ stdout, stderr, code: code ?? 1 });
        });
        if (opts?.stdin !== undefined) {
            child.stdin.write(opts.stdin);
        }
        child.stdin.end();
    });
}
export async function runPythonJson(scriptPath, args, opts) {
    const res = await runPythonScript(scriptPath, args, opts);
    if (res.code !== 0) {
        throw new AppError("python.failed", res.stderr.trim() || `Python exited with ${res.code}`, {
            code: res.code,
            stdout: res.stdout,
        });
    }
    try {
        return JSON.parse(res.stdout);
    }
    catch (err) {
        throw new AppError("python.failed", "Python 输出不是合法 JSON", {
            cause: err instanceof Error ? err.message : String(err),
        });
    }
}
