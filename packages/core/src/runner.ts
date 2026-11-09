/**
 * Python 规则脚本运行器。
 * - 定位 Python：指定的解释器（参数或环境变量 WRITER_PYTHON）只用它本身，未指定才按平台候选探测；校验 ≥ 3.8；
 * - 带超时与取消运行脚本；
 * - stdout 必须是且只是一个 JSON 对象，含 tool/rules_version/ok；否则一律 SCRIPT_FAILED，绝不当作通过。
 */
import { isMissingFileError } from "./fsx.js";
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
  /** The stream that outgrew its cap; the process was stopped and its output is incomplete. */
  overflow?: "stdout" | "stderr";
}

const KILL_GRACE_MS = 2000;
/** A rule script answers with one JSON object; anything near these sizes is a runaway script. */
const OUTPUT_LIMITS = { stdout: 8 * 1024 * 1024, stderr: 64 * 1024 } as const;

function exec(cmd: string, args: string[], opts: RunOptions = {}): Promise<Proc> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(new WriterError("CANCELLED", "已取消"));
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
    const size = { stdout: 0, stderr: 0 };
    let timedOut = false;
    let overflow: Proc["overflow"];
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
    const collect = (stream: "stdout" | "stderr", into: Buffer[]) => (chunk: Buffer) => {
      if (overflow) return;
      size[stream] += chunk.length;
      if (size[stream] <= OUTPUT_LIMITS[stream]) into.push(chunk);
      else {
        overflow = stream;
        stop();
      }
    };
    child.stdout.on("data", collect("stdout", out));
    child.stderr.on("data", collect("stderr", errb));
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
        overflow,
      });
    });
  });
}

export interface PythonCommand {
  cmd: string;
  prefix: string[];
}

const cache = new Map<string, Promise<PythonCommand>>();

/** 找可用 Python ≥ 3.8。explicit 为指定的解释器路径（整串即命令），指定了就不再自动探测。 */
export function locatePython(explicit?: string): Promise<PythonCommand> {
  const key = explicit?.trim() || process.env.WRITER_PYTHON?.trim() || "";
  let p = cache.get(key);
  if (!p) {
    p = findPython(explicit);
    cache.set(key, p);
    // allow-catch: evict the failed cache entry; callers receive the original rejected promise.
    p.catch(() => cache.delete(key));
  }
  return p;
}

const VERSION_PROBE = 'import sys;print("%d.%d"%sys.version_info[:2])';

/** 能跑且版本 ≥ 3.8 返回 undefined，否则返回原因；找不到命令时为"未找到"。 */
async function pythonProblem(c: PythonCommand): Promise<string | undefined> {
  let r: Proc;
  try {
    r = await exec(c.cmd, [...c.prefix, "-c", VERSION_PROBE], { timeoutMs: 15000 });
  } catch (error) {
    if (isMissingFileError(error)) return "未找到";
    throw error;
  }
  const m = /^(\d+)\.(\d+)/.exec(r.stdout.trim());
  if (r.code === 0 && m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 8)))
    return undefined;
  return m ? `版本 ${m[0]} 低于 3.8` : `无法运行（退出码 ${r.code}）`;
}

async function findPython(explicit?: string): Promise<PythonCommand> {
  // 指定了解释器就只用它：悄悄换成系统 Python 会让质检跑在作者不知道的环境里。
  const chosen = explicit?.trim() || process.env.WRITER_PYTHON?.trim();
  if (chosen) {
    const command = { cmd: chosen, prefix: [] };
    const problem = await pythonProblem(command);
    if (problem)
      throw new WriterError(
        "SCRIPT_FAILED",
        `指定的 Python 不可用：${chosen}（${problem}）。请检查环境变量 WRITER_PYTHON；安装包自带的 Python 损坏时请重新安装。`,
      );
    return command;
  }
  const candidates: PythonCommand[] =
    process.platform === "win32"
      ? [
          { cmd: "py", prefix: ["-3"] },
          { cmd: "python", prefix: [] },
          { cmd: "python3", prefix: [] },
        ]
      : [
          { cmd: "python3", prefix: [] },
          { cmd: "python", prefix: [] },
        ];
  const tried: string[] = [];
  for (const c of candidates) {
    const problem = await pythonProblem(c);
    if (!problem) return c;
    tried.push(`${[c.cmd, ...c.prefix].join(" ")}（${problem}）`);
  }
  throw new WriterError(
    "SCRIPT_FAILED",
    `找不到 Python 3.8+（试过：${tried.join("、")}）。请安装 Python，或用环境变量 WRITER_PYTHON 指定解释器路径。`,
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
    if (err instanceof WriterError) throw err;
    throw new WriterError(
      "SCRIPT_FAILED",
      `无法启动 Python：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (opts.signal?.aborted) throw new WriterError("CANCELLED", "已取消");
  if (r.overflow)
    throw new WriterError(
      "SCRIPT_FAILED",
      `脚本 ${r.overflow} 输出超过 ${OUTPUT_LIMITS[r.overflow] / 1024} KB，已终止：${script.split(/[\\/]/).pop()}`,
    );
  if (r.timedOut)
    throw new WriterError(
      "TIMEOUT",
      `脚本超时（${Math.round(timeoutMs / 1000)} 秒）：${script.split(/[\\/]/).pop()}`,
    );
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
