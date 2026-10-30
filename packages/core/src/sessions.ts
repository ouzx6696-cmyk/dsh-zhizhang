/**
 * 会话追踪与投递。
 *
 * 写作工作台没有会话上下文：它要把按钮指令发回“最近在这个数据目录上用过写作工具的主会话”。
 * 这里按数据目录记下那个会话（子代理不记），并持有宿主提供的投递通道（DSH sessionController.prompt）。
 * 记录持久化在 $DSH_HOME/writer-sessions.json，重启后仍能投递。进程级单例，多份打包副本共享。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { HostToolExecution, PromptSink } from '../../host/src/index.js'
import { atomicWrite } from './fsx.js'

export type { PromptSink }
export interface SessionRecord { sessionId: string; at: string }

interface Registry {
  sink?: PromptSink
  sessions: Map<string, SessionRecord>
  loaded: boolean
}
const KEY = Symbol.for('writer-agent.sessions')
function registry(): Registry {
  const g = globalThis as Record<symbol, Registry | undefined>
  return (g[KEY] ??= { sessions: new Map(), loaded: false })
}

export function setPromptSink(sink: PromptSink | undefined): () => void {
  const r = registry()
  const prev = r.sink
  r.sink = sink
  return () => { if (r.sink === sink) r.sink = prev }
}
export function promptSink(): PromptSink | undefined {
  return registry().sink
}

/** 子代理（编辑等）不能接收投递，也不覆盖主会话记录。出处：DSH rc.4 packages/subagent/subagent/src/depth.ts */
export function isDelegated(exec: HostToolExecution | null | undefined): boolean {
  const agent = exec?.agent as { session?: { header?: { delegationDepth?: number } }; options?: { subagentDepth?: number } } | undefined
  const depth = Math.max(Number(agent?.session?.header?.delegationDepth ?? 0) || 0, Number(agent?.options?.subagentDepth ?? 0) || 0)
  return depth > 0
}
function sessionIdOf(exec: HostToolExecution | null | undefined): string {
  const s = exec?.agent?.session as { id?: unknown; header?: { id?: unknown } } | undefined
  const id = s?.id ?? s?.header?.id
  return typeof id === 'string' ? id : ''
}
function keyOf(root: string) {
  return path.resolve(root).replaceAll('\\', '/').toLowerCase()
}
function file() {
  const home = (process.env.DSH_HOME ?? '').trim() || path.join(homedir(), '.dsh')
  return path.join(home, 'writer-sessions.json')
}
async function load(r: Registry) {
  if (r.loaded) return
  r.loaded = true
  try {
    const raw = JSON.parse(await readFile(file(), 'utf8')) as Record<string, Partial<SessionRecord>>
    for (const [k, v] of Object.entries(raw ?? {})) {
      if (typeof v?.sessionId === 'string' && !r.sessions.has(k)) r.sessions.set(k, { sessionId: v.sessionId, at: String(v.at ?? '') })
    }
  } catch { /* 还没有记录 */ }
}
async function persist(r: Registry) {
  try {
    await mkdir(path.dirname(file()), { recursive: true })
    await atomicWrite(file(), JSON.stringify(Object.fromEntries([...r.sessions.entries()].slice(-50)), null, 2) + '\n')
  } catch { /* 内存记录仍可用 */ }
}

/** 写作工具解析数据目录时调用：记下这个目录最近的主会话 */
export function rememberSession(root: string, exec: HostToolExecution | null | undefined) {
  if (!exec || isDelegated(exec)) return
  const sessionId = sessionIdOf(exec)
  if (!sessionId) return
  const r = registry()
  const key = keyOf(root)
  if (r.sessions.get(key)?.sessionId === sessionId) return
  r.sessions.delete(key)
  r.sessions.set(key, { sessionId, at: new Date().toISOString() })
  void persist(r)
}

export async function sessionFor(root: string): Promise<SessionRecord | undefined> {
  const r = registry()
  await load(r)
  return r.sessions.get(keyOf(root))
}

/** 投递失败的原因，供写作台展示；undefined 表示可以投递 */
export async function deliveryProblem(root: string): Promise<{ code: 'delivery_unavailable' | 'no_session'; message: string } | undefined> {
  if (!promptSink()) return { code: 'delivery_unavailable', message: '当前宿主没有会话控制服务（headless 或不支持的 DSH 版本），无法发到对话' }
  if (!(await sessionFor(root))) return { code: 'no_session', message: '这个数据目录还没有会话用过写作工具；先在对话里 writer_enable 一次，写作台才知道发到哪个会话' }
  return undefined
}

/** 把一条【写作台】消息发到该数据目录的主会话 */
export async function deliver(root: string, text: string, requestId?: string): Promise<{ sessionId: string; requestId: string }> {
  const sink = promptSink()
  const target = await sessionFor(root)
  if (!sink || !target) throw Object.assign(new Error((await deliveryProblem(root))?.message ?? '无法投递'), { code: sink ? 'no_session' : 'delivery_unavailable' })
  const id = requestId && /^[A-Za-z0-9_-]{8,80}$/.test(requestId) ? requestId : `wb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  await sink.prompt(target.sessionId, text, id)
  return { sessionId: target.sessionId, requestId: id }
}

/** 测试用 */
export function __resetSessions() {
  delete (globalThis as Record<symbol, Registry | undefined>)[KEY]
}
