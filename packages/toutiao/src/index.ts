/**
 * 今日头条模式。writer_enable(mode=toutiao, role) 调 mountToutiao，在调用方 Agent 作用域上挂：
 *   - 头条工具（编辑角色只挂红笔/质检相关的 9 个）；
 *   - 常驻总则段落；
 *   - 门禁（tools/pre-execute）。
 * 写作台接口在 workbench/。
 */
import { addPromptSection, onPreExecute, WriterError, type HostContext } from '../../host/src/index.js'
import { createGateEngine, type GateEngine } from '../../core/src/gates.js'
import { TOUTIAO_BRIEF, TOUTIAO_EDITOR_BRIEF } from './brief.js'
import type { ToutiaoConfig } from './config.js'
import { toutiaoGateRules } from './gates.js'
import { createToutiaoTools, EDITOR_TOOLS, type Role } from './tools.js'

const ORDER_SECTION = 109

interface Mounted { engine: GateEngine; role: Role; disposers: (() => void)[] }
const mounted = new WeakMap<object, Mounted>()

/** 在一个 Agent 作用域上挂载头条能力（按角色）。导出供测试复用。 */
export function mountToutiao(
  agentCtx: HostContext, config: ToutiaoConfig, host?: HostContext, role: Role = 'writer',
): { tools: string[]; engine: GateEngine; promptSection: boolean; gates: boolean; role: Role } {
  const existing = mounted.get(agentCtx)
  if (existing) {
    if (existing.role !== role) throw new WriterError('CONFLICT', `本会话已按「${existing.role === 'editor' ? '编辑' : '写手'}」启用，不能改成另一角色；请新开会话或子代理`)
    return { tools: [], engine: existing.engine, promptSection: true, gates: true, role }
  }
  const disposers: (() => void)[] = []
  let engine!: GateEngine
  try {
    const rules = toutiaoGateRules(config, host)
    // 编辑角色只挂与其工具相关的门禁，其余工具对它而言是“不存在”，不是“被拦下”
    engine = createGateEngine(role === 'editor' ? rules.filter(r => EDITOR_TOOLS.has(r.tool)) : rules, { disabled: config.disabledGates })
    const all = createToutiaoTools({ config, host, gates: () => engine, role })
    const tools = role === 'editor' ? all.filter(t => EDITOR_TOOLS.has(t.name)) : all
    for (const t of tools) {
      const d = agentCtx.tools!.register(t)
      if (typeof d === 'function') disposers.push(d)
    }
    const brief = role === 'editor' ? TOUTIAO_EDITOR_BRIEF : TOUTIAO_BRIEF
    const section = addPromptSection(agentCtx, `tool:writer-toutiao${role === 'editor' ? '-editor' : ''}`, ORDER_SECTION, () => brief)
    if (section) disposers.push(section)
    const gate = onPreExecute(agentCtx, exec => engine.evaluate(exec))
    if (gate) disposers.push(gate)
    mounted.set(agentCtx, { engine, role, disposers })
    return { tools: tools.map(t => t.name), engine, promptSection: !!section, gates: !!gate, role }
  } catch (err) {
    for (const d of disposers) { try { d() } catch { /* 回滚尽力而为 */ } }
    throw err
  }
}


/** 启用回执里头条部分 */
export function toutiaoNext(role: Role): string {
  return role === 'editor'
    ? '先 toutiao_article_get(include_draft=true)，再取 s5-editing。'
    : '先 toutiao_feedback_read，再按总则从 S1 或 S2 开始；每步前用 toutiao_method_get 取方法。'
}

export { TOUTIAO_BRIEF, TOUTIAO_EDITOR_BRIEF }
export { toutiaoApi } from './workbench/api.js'
export type { ToutiaoConfig } from './config.js'
export { parseToutiaoConfig } from './config.js'
export type { Role } from './tools.js'
