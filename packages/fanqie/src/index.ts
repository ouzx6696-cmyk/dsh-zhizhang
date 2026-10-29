/**
 * writer-fanqie — 番茄长篇（建立在织章 dsh-zhizhang 之上，不改织章）。
 *
 * 触发：fanqie_enable（role=writer|editor），或观察到同一会话 zhizhang_enable 成功后自动挂载（autoMount）。
 * 挂载内容：fanqie_* 工具、长篇补充段落、长篇门禁（拦同一会话里的 zhizhang_* 调用）。
 */
import {
  enableIntegratedZhizhang, addPromptSection, agentContextOf, defineWriterTool, onPreExecute, WriterError,
  type HostContext, type HostToolDefinition, type HostToolExecution,
} from '../../dsh-adapter/src/index.js'
import { genres } from '../../core/src/genre.js'
import { createGateEngine, type GateEngine } from '../../gates/src/index.js'
import { FANQIE_BRIEF, FANQIE_EDITOR_BRIEF } from './brief.js'
import type { FanqieConfig } from './env.js'
import { fanqieGateRules } from './gates.js'
import { createFanqieTools, type Role } from './tools.js'

export type { FanqieConfig } from './env.js'
export { FANQIE_BRIEF, FANQIE_EDITOR_BRIEF }

const ORDER_SECTION = 110

interface Mounted { engine: GateEngine; role: Role; disposers: (() => void)[] }
const mounted = new WeakMap<object, Mounted>()
/** 已观察到 zhizhang_enable 成功的 Agent */
const zhizhangOn = new WeakSet<object>()

export function isFanqieMounted(agentCtx: object): Role | undefined {
  return mounted.get(agentCtx)?.role
}

export function mountFanqie(agentCtx: HostContext, config: FanqieConfig, role: Role = 'writer') {
  const existing = mounted.get(agentCtx)
  if (existing) {
    if (existing.role !== role) throw new WriterError('CONFLICT', `本会话已按「${existing.role === 'editor' ? '编辑' : '写手'}」启用长篇，不能改成另一角色；编辑请用子代理`)
    return { tools: [] as string[], engine: existing.engine, promptSection: true, gates: true, role }
  }
  const disposers: (() => void)[] = []
  try {
    const engine = createGateEngine(fanqieGateRules(config, role), { disabled: config.disabledGates })
    const tools = createFanqieTools({ config, role })
    for (const t of tools) {
      const d = agentCtx.tools!.register(t)
      if (typeof d === 'function') disposers.push(d)
    }
    const brief = role === 'editor' ? FANQIE_EDITOR_BRIEF : FANQIE_BRIEF
    const section = addPromptSection(agentCtx, `tool:writer-fanqie${role === 'editor' ? '-editor' : ''}`, ORDER_SECTION, () => brief)
    if (section) disposers.push(section)
    const gate = onPreExecute(agentCtx, exec => engine.evaluate(exec))
    if (gate) disposers.push(gate)
    mounted.set(agentCtx, { engine, role, disposers })
    return { tools: tools.map(t => t.name), engine, promptSection: !!section, gates: !!gate, role }
  } catch (err) {
    for (const d of disposers) { try { d() } catch { /* 尽力回滚 */ } }
    throw err
  }
}

export function makeFanqieEnableTool(config: FanqieConfig): HostToolDefinition {
  return defineWriterTool<{ role?: string }>({
    name: 'fanqie_enable',
    description: '【按需启用】作者要写番茄长篇网文、开新书、续写章节、审读定稿、拆书时调用：加载长篇方法、规则检查、编辑审读回报与定稿门禁（建立在织章之上，同时启用内置织章）。编辑子代理传 role=editor。',
    properties: { role: { type: 'string', enum: ['writer', 'editor'], description: 'writer=主写手（默认）；editor=编辑子代理，只审不定稿' } },
    async run(args, exec) {
      const agentCtx = agentContextOf(exec)
      if (!agentCtx) throw new WriterError('INVALID_ARGS', '当前调用没有 Agent 作用域，无法按会话启用；请在新会话重试')
      const role: Role = args.role === 'editor' ? 'editor' : 'writer'
      genres.claim(exec, 'fanqie')
      const r = mountFanqie(agentCtx, config, role)
      const zz = zhizhangOn.has(agentCtx) || await enableIntegratedZhizhang(exec)
      if (zz) zhizhangOn.add(agentCtx)
      return {
        enabled: true,
        role,
        already_enabled: r.tools.length === 0,
        tool_count: r.tools.length || undefined,
        prompt_section: r.promptSection,
        gates: r.gates,
        zhizhang_enabled: zz,
        brief: r.promptSection ? undefined : role === 'editor' ? FANQIE_EDITOR_BRIEF : FANQIE_BRIEF,
        next: zz
          ? (role === 'editor' ? '先 zhizhang_chapter_read 取本章，再取 novel-writer/references/editor_method。' : '按长篇补充规则走；开书先 fanqie_method_get inspiration-forge/SKILL。')
          : '接着调用 zhizhang_enable 加载织章工具（未安装织章插件的话，检查 writer-zhizhang 插件行是否加载）。',
      }
    },
  })
}

/** 宿主级挂载：注册 fanqie_enable，并在观察到 zhizhang_enable 成功时自动挂载 */
export function applyFanqie(ctx: HostContext, config: FanqieConfig = {}) {
  ctx.tools?.register(makeFanqieEnableTool(config))
}

/** 由应用层的 tools/result 观察者调用：某会话 zhizhang_enable 成功了 */
export function onZhizhangEnabled(exec: HostToolExecution, config: FanqieConfig) {
  const agentCtx = agentContextOf(exec)
  if (!agentCtx) return
  zhizhangOn.add(agentCtx)
  if (config.autoMount !== false && !mounted.has(agentCtx)) {
    try { mountFanqie(agentCtx, config, 'writer') } catch { /* 挂载失败不影响织章本身 */ }
  }
}
