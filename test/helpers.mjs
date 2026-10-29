// 测试工具：一个最小"假宿主"，按 DSH ToolRuntime 的语义模拟 register / tools/pre-execute 瀑布 / ask→审批。
import { mkdtemp, cp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const BUILD = path.join(ROOT, 'build')
export const SKILL = path.join(ROOT, 'packages', 'toutiao', 'skill')
export const FIX = path.join(SKILL, 'tests', 'fixtures')

export async function tempDir(prefix = 'writer-') {
  return mkdtemp(path.join(tmpdir(), prefix))
}

export function fakeHost({ approve = 'allowed-once' } = {}) {
  const make = () => {
    const tools = new Map()
    const pre = []
    const results = []
    const sections = []
    const ctx = {
      tools: { register(def) { tools.set(def.name, def); return () => tools.delete(def.name) } },
      on(event, fn) {
        if (event === 'tools/pre-execute') { pre.push(fn); return () => pre.splice(pre.indexOf(fn), 1) }
        if (event === 'tools/result') { results.push(fn); return () => results.splice(results.indexOf(fn), 1) }
      },
      get(name) { if (name === 'systemPrompt') return { section(s) { sections.push(s); return () => {} } } },
    }
    return { ctx, tools, pre, results, sections }
  }
  const root = make()
  const approvals = []
  const host = {
    root, approvals, approve,
    agents: new Map(),
    agent(id, cwd) {
      if (!this.agents.has(id)) {
        const scope = make()
        this.agents.set(id, { id, ctx: scope.ctx, scope, session: { id, header: { cwd } } })
      }
      return this.agents.get(id)
    },
    async call(agent, name, args = {}) {
      const scope = agent?.scope
      const def = scope?.tools.get(name) ?? root.tools.get(name)
      if (!def) throw new Error(`unknown tool ${name}`)
      const exec = { callId: String(Math.random()), name, arguments: structuredClone(args), agent, token: Symbol('exec'), signal: new AbortController().signal }
      const chain = [...root.pre, ...(scope?.pre ?? [])]
      const run = async (i) => (i >= chain.length ? { kind: 'allow' } : chain[i](exec, () => run(i + 1)))
      let decision = await run(0)
      if (decision.kind === 'ask') {
        approvals.push({ name, reason: decision.reason })
        decision = this.approve === 'allowed-once' ? { kind: 'allow' } : { kind: 'deny', reason: 'the user rejected' }
      }
      if (decision.kind === 'deny') return { denied: true, reason: decision.reason }
      let value, isError = false
      try { value = await def.execute(args, exec) } catch (e) { isError = true; value = { error: String(e) } }
      for (const fn of root.results) fn(exec, isError ? { isError } : { isError, value })
      return value
    },
  }
  return host
}

export async function copyFixtures(dir) {
  await cp(FIX, dir, { recursive: true })
}
