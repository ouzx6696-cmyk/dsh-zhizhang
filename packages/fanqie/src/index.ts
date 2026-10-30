/**
 * 番茄长篇模式。writer_enable(mode=fanqie, role) 调 mountFanqie，在调用方 Agent 作用域上挂：
 *   - 引擎（engine/）：作品存储与创作工具链，fanqie_* 工具 + 硬规则段落；
 *   - 写作层：forge 方法、章纲与旧账检查、拆书测绘、引文核对、编辑审读回报（tools.ts）+ 补充规则（brief.ts）；
 *   - 长篇门禁（gates.ts）：定稿与 force 须作者确认、可选"定稿前须编辑通过"、编辑只读。
 * 写作台接口在 workbench/。
 */
import { addPromptSection, onPreExecute, WriterError, type HostContext } from '../../host/src/index.js'
import { createGateEngine, type GateEngine } from '../../core/src/gates.js'
import { FANQIE_BRIEF, FANQIE_EDITOR_BRIEF } from './brief.js'
import type { FanqieConfig } from './config.js'
import { configureEngine, engineSummary, mountEngine } from './engine/index.js'
import { fanqieGateRules } from './gates.js'
import { createFanqieTools, type Role } from './tools.js'
import { fanqieApi } from './workbench/api.js'

export type { FanqieConfig } from './config.js'
export { parseFanqieConfig } from './config.js'
export { FANQIE_BRIEF, FANQIE_EDITOR_BRIEF, fanqieApi }
export { fanqieLibrary } from './forge.js'

const ORDER_SECTION = 110

interface Mounted { engine: GateEngine; role: Role; disposers: (() => void)[] }
const mounted = new WeakMap<object, Mounted>()

/** 插件加载时调用一次：数据位置、端口策略 */
export function configureFanqie(config: FanqieConfig) {
  configureEngine(config)
}

export interface FanqieMount { fresh: boolean; engine?: string; tools: string[]; promptSection: boolean; gates: boolean; role: Role }

export function mountFanqie(agentCtx: HostContext, config: FanqieConfig, role: Role = 'writer'): FanqieMount {
  const existing = mounted.get(agentCtx)
  if (existing) {
    if (existing.role !== role) throw new WriterError('CONFLICT', `本会话已按「${existing.role === 'editor' ? '编辑' : '写手'}」启用番茄长篇，不能改成另一角色；编辑请用子代理`)
    return { fresh: false, tools: [], promptSection: true, gates: true, role }
  }
  const fresh = mountEngine(agentCtx, config)
  const disposers: (() => void)[] = []
  try {
    const gateEngine = createGateEngine(fanqieGateRules(config, role), { disabled: config.disabledGates })
    const tools = createFanqieTools({ config, role })
    for (const t of tools) {
      const d = agentCtx.tools!.register(t)
      if (typeof d === 'function') disposers.push(d)
    }
    const brief = role === 'editor' ? FANQIE_EDITOR_BRIEF : FANQIE_BRIEF
    const section = addPromptSection(agentCtx, `tool:writer-fanqie${role === 'editor' ? '-editor' : ''}`, ORDER_SECTION, () => brief)
    if (section) disposers.push(section)
    const gate = onPreExecute(agentCtx, exec => gateEngine.evaluate(exec))
    if (gate) disposers.push(gate)
    mounted.set(agentCtx, { engine: gateEngine, role, disposers })
    return { fresh, engine: fresh ? engineSummary() : undefined, tools: tools.map(t => t.name), promptSection: !!section, gates: !!gate, role }
  } catch (err) {
    for (const d of disposers) { try { d() } catch { /* 尽力回滚 */ } }
    throw err
  }
}

export function fanqieNext(role: Role): string {
  return role === 'editor'
    ? '先 fanqie_chapter_read 取本章，再 fanqie_forge_get edit。'
    : '开书先 fanqie_forge_get overview 与 plan-foundation，再 fanqie_project_create；已有作品用 fanqie_project_open，再看 fanqie_product_map 的默认链。'
}
