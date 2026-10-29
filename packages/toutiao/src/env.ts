/** 每次调用的运行环境：存储根、Python、门禁。 */
import path from 'node:path'
import { homedir } from 'node:os'
import { sessionCwd, type HostContext, type HostToolExecution } from '../../dsh-adapter/src/index.js'
import { atomicWrite, readJson } from '../../core/src/fsx.js'
import { locatePython, runScript, type ScriptResult } from '../../core/src/runner.js'
import { WriterError } from '../../dsh-adapter/src/index.js'
import { ArticleStore } from './store.js'
import { bridgeScript } from './methods.js'

export interface ToutiaoConfig {
  /** 相对会话 cwd 的数据目录，默认 outputs/toutiao（与 toutiao-viral-writer 4.0.0 一致） */
  rootDir?: string
  /** 固定的绝对数据目录，设置后忽略 rootDir */
  storageRoot?: string
  /** Python 命令，如 C:\\Python312\\python.exe 或 "py -3" */
  python?: string
  /** 关闭的非锁定门禁 id */
  disabledGates?: string[]
  /** 是否挂载写作台面板（仅本机访问），默认 true */
  panel?: boolean
  /** true：送“待验收”前当前版本必须出自编辑子代理或作者（写手与编辑分离），默认 false */
  requireEditorPass?: boolean
}

export function rootFor(config: ToutiaoConfig, exec?: HostToolExecution, host?: HostContext): string {
  const sr = (config.storageRoot ?? process.env.WRITER_TOUTIAO_ROOT ?? '').trim()
  if (sr) return path.resolve(sr)
  return path.resolve(sessionCwd(exec, host), config.rootDir?.trim() || 'outputs/toutiao')
}

export function storeFor(config: ToutiaoConfig, exec?: HostToolExecution, host?: HostContext): ArticleStore {
  const root = rootFor(config, exec, host)
  rememberRoot(root)
  return new ArticleStore(root)
}

/* 面板没有会话，记住工具用过的存储根（内存 + DSH home 下一个小文件） */
const knownRoots = new Set<string>()
function rootsFile(): string {
  return path.join((process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh'), 'writer-toutiao-roots.json')
}
let loaded = false
export async function listKnownRoots(): Promise<string[]> {
  if (!loaded) {
    loaded = true
    const saved = await readJson<string[]>(rootsFile()).catch(() => undefined)
    if (Array.isArray(saved)) for (const r of saved) if (typeof r === 'string') knownRoots.add(r)
  }
  return [...knownRoots]
}
function rememberRoot(root: string) {
  if (knownRoots.has(root)) return
  knownRoots.add(root)
  const list = [...knownRoots].slice(-20)
  void atomicWrite(rootsFile(), JSON.stringify(list)).catch(() => undefined)
}

export async function bridge(config: ToutiaoConfig, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ScriptResult> {
  const py = await locatePython(config.python)
  const r = await runScript(py, bridgeScript(), args, opts)
  if (!r.ok) {
    const code = r.code === 'TIMEOUT' ? 'TIMEOUT' : r.code === 'NOT_FOUND' ? 'NOT_FOUND' : r.code === 'INVALID_INPUT' ? 'INVALID_ARGS' : 'SCRIPT_FAILED'
    throw new WriterError(code, String(r.message ?? '规则脚本失败'))
  }
  return r
}
