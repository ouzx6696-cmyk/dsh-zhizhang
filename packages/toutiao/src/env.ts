/** 每次调用的运行环境：存储根、Python、门禁。 */
import path from 'node:path'
import { stateRoot } from '../../core/src/paths.js'
import { type ToolExecution } from '../../core/src/tool.js'
import { atomicWrite, readJson, serialize } from '../../core/src/fsx.js'
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

export async function storeFor(config: ToutiaoConfig, exec: ToolExecution): Promise<ArticleStore> {
  const root = rootFor(config, exec)
  await rememberRoot(root)
  return new ArticleStore(root)
}

/* 面板没有会话，记住工具用过的存储根（内存 + 应用状态目录 下一个小文件） */
function rootsFile(): string { return path.join(stateRoot(), 'writer-toutiao-roots.json'); }
const knownRoots = new Map<string, string[]>();
export async function listKnownRoots(): Promise<string[]> {
  const file = rootsFile(), cached = knownRoots.get(file);
  if (cached) return [...cached];
  const saved = await readJson<unknown>(file);
  if (saved !== undefined && (!Array.isArray(saved) || saved.some(value => typeof value !== 'string')))
    throw new WriterError('CONFLICT', '头条目录索引损坏，请保留原文件并检查');
  const roots = saved === undefined ? [] : saved as string[];
  knownRoots.set(file, roots);
  return [...roots];
}
export async function rememberRoot(root: string) {
  const file = rootsFile();
  await serialize(file, async () => {
    const roots = await listKnownRoots();
    if (roots.includes(root)) return;
    const next = [...roots, root].slice(-20);
    await atomicWrite(file, JSON.stringify(next));
    knownRoots.set(file, next);
  });
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
