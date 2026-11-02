/** 每次调用的运行环境：存储根、Python、门禁。 */
import path from 'node:path'
import { stateRoot } from '../../core/src/paths.js'
import { type ToolExecution } from '../../core/src/tool.js'
import { atomicWrite, readJson } from '../../core/src/fsx.js'
import { locatePython, runScript, type ScriptResult } from '../../core/src/runner.js'
import { WriterError } from '../../core/src/tool.js'
import { ArticleStore } from './store.js'
import { bridgeScript } from './methods.js'

export type { ToutiaoConfig } from './config.js'
import type { ToutiaoConfig } from './config.js'

export function rootFor(config: ToutiaoConfig, exec: ToolExecution): string {
  const sr = (config.storageRoot ?? process.env.WRITER_TOUTIAO_ROOT ?? '').trim()
  if (sr) return path.resolve(sr)
  return path.resolve(exec.cwd, config.rootDir?.trim() || 'outputs/toutiao')
}

export function storeFor(config: ToutiaoConfig, exec: ToolExecution): ArticleStore {
  const root = rootFor(config, exec)
  rememberRoot(root)
  return new ArticleStore(root)
}

/* 面板没有会话，记住工具用过的存储根（内存 + 应用状态目录 下一个小文件） */
const knownRoots = new Set<string>()
function rootsFile(): string {
  return path.join(stateRoot(), 'writer-toutiao-roots.json')
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
export function rememberRoot(root: string) {
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
