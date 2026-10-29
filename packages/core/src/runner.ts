/**
 * Python 规则脚本运行器（dev-plan §5.1）。
 * - 定位 Python（配置 → 环境变量 WRITER_PYTHON → 平台候选），校验 3.11；
 * - 带超时与取消运行脚本；
 * - stdout 必须是且只是一个 JSON 对象，含 tool/rules_version/ok；否则一律 SCRIPT_FAILED，绝不当作通过。
 */
import { spawn } from 'node:child_process'
import { WriterError } from '../../dsh-adapter/src/index.js'

export interface ScriptResult {
  tool: string
  rules_version: string
  ok: boolean
  code?: string
  message?: string
  [k: string]: unknown
}

export interface RunOptions {
  timeoutMs?: number
  signal?: AbortSignal
  cwd?: string
}

interface Proc { code: number | null; stdout: string; stderr: string; timedOut: boolean }

function exec(cmd: string, args: string[], opts: RunOptions = {}): Promise<Proc> {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
        windowsHide: true,
      })
    } catch (err) { reject(err); return }
    const out: Buffer[] = []
    const errb: Buffer[] = []
    let timedOut = false
    const timer = opts.timeoutMs ? setTimeout(() => { timedOut = true; child.kill() }, opts.timeoutMs) : undefined
    const onAbort = () => child.kill()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => errb.push(d))
    child.on('error', (e) => { if (timer) clearTimeout(timer); opts.signal?.removeEventListener('abort', onAbort); reject(e) })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(errb).toString('utf8'), timedOut })
    })
  })
}

export interface PythonCommand { cmd: string; prefix: string[] }

const cache = new Map<string, Promise<PythonCommand>>()

/** 找可用 Python 3.11。explicit 为配置项 python（可写 "py -3" 这类带参数的命令）。 */
export function locatePython(explicit?: string): Promise<PythonCommand> {
  const key = explicit ?? ''
  let p = cache.get(key)
  if (!p) {
    p = findPython(explicit)
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

async function findPython(explicit?: string): Promise<PythonCommand> {
  const candidates: PythonCommand[] = []
  const add = (s: string | undefined) => {
    if (!s || !s.trim()) return
    const parts = s.trim().split(/\s+/)
    candidates.push({ cmd: parts[0]!, prefix: parts.slice(1) })
  }
  add(explicit)
  add(process.env.WRITER_PYTHON)
  if (process.platform === 'win32') { add('py -3.11'); add('py -3'); add('python'); add('python3') }
  else { add('python3.11'); add('python3'); add('python') }
  const tried: string[] = []
  for (const c of candidates) {
    tried.push([c.cmd, ...c.prefix].join(' '))
    try {
      const r = await exec(c.cmd, [...c.prefix, '-c', 'import sys;print("%d.%d"%sys.version_info[:2])'], { timeoutMs: 15000 })
      const m = /^(\d+)\.(\d+)/.exec(r.stdout.trim())
      if (r.code === 0 && m && Number(m[1]) === 3 && Number(m[2]) === 11) return c
    } catch { /* 下一个 */ }
  }
  throw new WriterError('SCRIPT_FAILED', `找不到 Python 3.11（试过：${tried.join('、')}）。请安装 Python，或在插件配置里填写 python 路径。`)
}

/** 运行脚本并按契约解析。 */
export async function runScript(python: PythonCommand, script: string, args: string[], opts: RunOptions = {}): Promise<ScriptResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000
  let r: Proc
  try {
    r = await exec(python.cmd, [...python.prefix, script, ...args], { ...opts, timeoutMs })
  } catch (err: any) {
    throw new WriterError('SCRIPT_FAILED', `无法启动 Python：${err?.message ?? err}`)
  }
  if (r.timedOut) throw new WriterError('TIMEOUT', `脚本超时（${Math.round(timeoutMs / 1000)} 秒）：${script.split(/[\\/]/).pop()}`)
  if (opts.signal?.aborted) throw new WriterError('SCRIPT_FAILED', '已取消')
  return parseContract(r.stdout, r.stderr, r.code)
}

export function parseContract(stdout: string, stderr: string, code: number | null): ScriptResult {
  const text = stdout.trim()
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new WriterError('SCRIPT_FAILED', `脚本输出不是合法 JSON（退出码 ${code}）：${(text || stderr).slice(0, 400)}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WriterError('SCRIPT_FAILED', '脚本输出不是 JSON 对象')
  const v = value as Record<string, unknown>
  if (typeof v.tool !== 'string' || typeof v.rules_version !== 'string' || typeof v.ok !== 'boolean') {
    throw new WriterError('SCRIPT_FAILED', '脚本输出缺少契约字段 tool / rules_version / ok')
  }
  if (code !== 0) throw new WriterError('SCRIPT_FAILED', `脚本退出码 ${code}：${stderr.slice(0, 400)}`)
  return v as ScriptResult
}
