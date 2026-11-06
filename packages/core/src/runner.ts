/**
 * Python 规则脚本运行器。
 * - 定位 Python（配置 → 环境变量 WRITER_PYTHON → 平台候选），校验 ≥ 3.8；
 * - 带超时与取消运行脚本；
 * - stdout 必须是且只是一个 JSON 对象，含 tool/rules_version/ok；否则一律 SCRIPT_FAILED，绝不当作通过。
 */
import { isMissingFileError } from "./fsx.js";
import path from "node:path";
import { spawn } from "node:child_process";
import { WriterError } from "./tool.js";

export interface ScriptResult {
  tool: string;
  rules_version: string;
  ok: boolean;
  code?: string;
  message?: string;
  [k: string]: unknown;
}

export interface RunOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  cwd?: string;
}

interface Proc {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const KILL_GRACE_MS = 2000;

function exec(cmd: string, args: string[], opts: RunOptions = {}): Promise<Proc> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new WriterError("SCRIPT_FAILED", "已取消"));
      return;
    }
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
        windowsHide: true,
      });
    } catch (err) {
      reject(err);
      return;
    }
    const out: Buffer[] = [];
    const errb: Buffer[] = [];
    let timedOut = false;
    let forceKill: NodeJS.Timeout | undefined;
    // A script that traps or ignores SIGTERM must not hang the tool call forever.
    const stop = () => {
      // Windows 上 `py -3` 会再起一个 python.exe；只杀启动器时它仍持有 stdout 管道，
      // close 事件永不触发，工具调用照样挂死。taskkill /T 才能杀掉整棵进程树。
      if (process.platform === "win32") {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
        killer.on("error", () => child.kill());
        killer.on("close", (code) => {
          if (code !== 0) child.kill();
        });
      } else {
        child.kill();
      }
      forceKill ??= setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS);
    };
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          stop();
        }, opts.timeoutMs)
      : undefined;
    opts.signal?.addEventListener("abort", stop, { once: true });
    const settle = () => {
      clearTimeout(timer);
      clearTimeout(forceKill);
      opts.signal?.removeEventListener("abort", stop);
    };
    child.stdout.on("data", (d: Buffer) => out.push(d));
    child.stderr.on("data", (d: Buffer) => errb.push(d));
    child.on("error", (e) => {
      settle();
      reject(e);
    });
    child.on("close", (code) => {
      settle();
      resolve({
        code,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(errb).toString("utf8"),
        timedOut,
      });
    });
  });
}

export interface PythonCommand {
  cmd: string;
  prefix: string[];
}

const cache = new Map<string, Promise<PythonCommand>>();

/** 找可用 Python ≥ 3.8。explicit 为配置项 python（可写 "py -3" 这类带参数的命令）。 */
export function locatePython(explicit?: string): Promise<PythonCommand> {
  const key = explicit ?? "";
  let p = cache.get(key);
  if (!p) {
    p = findPython(explicit);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

async function findPython(explicit?: string): Promise<PythonCommand> {
  const candidates: PythonCommand[] = [];
  const add = (s: string | undefined) => {
    if (!s || !s.trim()) return;
    if (path.isAbsolute(s.trim())) {
      candidates.push({ cmd: s.trim(), prefix: [] });
      return;
    }
    const parts = s.trim().split(/\s+/);
    candidates.push({ cmd: parts[0], prefix: parts.slice(1) });
  };
  add(explicit);
  add(process.env.WRITER_PYTHON);
  if (process.platform === "win32") {
    add("py -3");
    add("python");
    add("python3");
  } else {
    add("python3");
    add("python");
  }
  const tried: string[] = [];
  for (const c of candidates) {
    tried.push([c.cmd, ...c.prefix].join(" "));
    try {
      const r = await exec(
        c.cmd,
        [...c.prefix, "-c", 'import sys;print("%d.%d"%sys.version_info[:2])'],
        { timeoutMs: 15000 },
      );
      const m = /^(\d+)\.(\d+)/.exec(r.stdout.trim());
      if (r.code === 0 && m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 8)))
        return c;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
  }
  throw new WriterError(
    "SCRIPT_FAILED",
    `找不到 Python 3.8+（试过：${tried.join("、")}）。请安装 Python，或在插件配置里填写 python 路径。`,
  );
}

/** 运行脚本并按契约解析。 */
export async function runScript(
  python: PythonCommand,
  script: string,
  args: string[],
  opts: RunOptions = {},
): Promise<ScriptResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let r: Proc;
  try {
    r = await exec(python.cmd, [...python.prefix, script, ...args], { ...opts, timeoutMs });
  } catch (err) {
    throw new WriterError(
      "SCRIPT_FAILED",
      `无法启动 Python：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (r.timedOut)
    throw new WriterError(
      "TIMEOUT",
      `脚本超时（${Math.round(timeoutMs / 1000)} 秒）：${script.split(/[\\/]/).pop()}`,
    );
  if (opts.signal?.aborted) throw new WriterError("SCRIPT_FAILED", "已取消");
  return parseContract(r.stdout, r.stderr, r.code);
}

export function parseContract(stdout: string, stderr: string, code: number | null): ScriptResult {
  const text = stdout.trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new WriterError(
      "SCRIPT_FAILED",
      `脚本输出不是合法 JSON（退出码 ${code}）：${(text || stderr).slice(0, 400)}`,
    );
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new WriterError("SCRIPT_FAILED", "脚本输出不是 JSON 对象");
  const v = value as Record<string, unknown>;
  if (
    typeof v.tool !== "string" ||
    typeof v.rules_version !== "string" ||
    typeof v.ok !== "boolean"
  ) {
    throw new WriterError("SCRIPT_FAILED", "脚本输出缺少契约字段 tool / rules_version / ok");
  }
  if (code !== 0)
    throw new WriterError("SCRIPT_FAILED", `脚本退出码 ${code}：${stderr.slice(0, 400)}`);
  return v as ScriptResult;
}
