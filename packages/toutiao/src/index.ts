/**
 * writer-toutiao — DSH 插件入口（头条 MVP）。
 *
 * 挂载时只注册一个触发工具 toutiao_enable（与织章相同的按需启用模式，普通会话不受打扰）
 * 以及本机写作台面板路由。toutiao_enable 被调用后，在调用方 Agent 作用域上注册：
 *   - 全部头条工具；
 *   - 常驻总则段落（system prompt section）；
 *   - tools/pre-execute 门禁。
 */
import {
  addPromptSection, agentContextOf, defineWriterTool, onPreExecute, registerRoutes, WriterError,
  type HostContext, type HostToolDefinition,
} from '../../dsh-adapter/src/index.js'
import { genres } from '../../core/src/genre.js'
import { createGateEngine, type GateEngine } from '../../gates/src/index.js'
import { TOUTIAO_BRIEF, TOUTIAO_EDITOR_BRIEF } from './brief.js'
import type { ToutiaoConfig } from './env.js'
import { toutiaoGateRules } from './gates.js'
import { createPanelHandlers, PANEL_PATH } from './panel.js'
import { createToutiaoTools, EDITOR_TOOLS, type Role } from './tools.js'

export const name = 'writer-toutiao'
export const inject = ['tools']

/** Standard Schema（DSH 在加载时校验插件 config，填默认值）。 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'writer-toutiao',
    validate(input: unknown) {
      const v = (input ?? {}) as Record<string, unknown>
      if (typeof v !== 'object' || Array.isArray(v)) return { issues: [{ message: '插件配置必须是对象' }] }
      const issues: { message: string; path?: string[] }[] = []
      for (const k of ['rootDir', 'storageRoot', 'python'] as const) {
        if (v[k] !== undefined && typeof v[k] !== 'string') issues.push({ message: `${k} 应为字符串`, path: [k] })
      }
      for (const k of ['panel', 'requireEditorPass'] as const) {
        if (v[k] !== undefined && typeof v[k] !== 'boolean') issues.push({ message: `${k} 应为布尔值`, path: [k] })
      }
      if (v.disabledGates !== undefined && !(Array.isArray(v.disabledGates) && v.disabledGates.every(x => typeof x === 'string'))) {
        issues.push({ message: 'disabledGates 应为字符串数组', path: ['disabledGates'] })
      }
      if (issues.length) return { issues }
      return { value: { rootDir: 'outputs/toutiao', panel: true, ...v } }
    },
  },
}

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


export function makeEnableTool(config: ToutiaoConfig, host?: HostContext): HostToolDefinition {
  return defineWriterTool<{ role?: string }>({
    name: 'toutiao_enable',
    description: '【按需启用】作者要写今日头条图文/微头条、找热点、起标题、去 AI 味、发稿前质检时调用：把头条写作工具、总则和门禁加载到当前会话。编辑子代理调用时传 role=editor。',
    properties: { role: { type: 'string', enum: ['writer', 'editor'], description: 'writer=主写手（默认）；editor=编辑子代理，只能红笔与质检' } },
    async run(args, exec) {
      const agentCtx = agentContextOf(exec)
      if (!agentCtx) throw new WriterError('INVALID_ARGS', '当前调用没有 Agent 作用域，无法按会话启用；请在新会话重试')
      const role: Role = args.role === 'editor' ? 'editor' : 'writer'
      genres.claim(exec, 'toutiao')
      const r = mountToutiao(agentCtx, config, host, role)
      const already = r.tools.length === 0
      const brief = role === 'editor' ? TOUTIAO_EDITOR_BRIEF : TOUTIAO_BRIEF
      return {
        enabled: true,
        role,
        already_enabled: already,
        tool_count: r.tools.length || undefined,
        prompt_section: r.promptSection,
        gates: r.gates,
        panel: config.panel === false || role === 'editor' ? null : PANEL_PATH,
        // 宿主不支持段落注入时，把总则放进回执，保证模型拿得到
        brief: r.promptSection ? undefined : brief,
        next: role === 'editor'
          ? '先 toutiao_article_get(include_draft=true)，再取 s5-editing。'
          : '先 toutiao_feedback_read，再按总则从 S1 或 S2 开始；每步前用 toutiao_method_get 取方法。',
      }
    },
  })
}

export function apply(ctx: HostContext, config: ToutiaoConfig = {}) {
  ctx.tools?.register(makeEnableTool(config, ctx))
  if (config.panel !== false) registerRoutes(ctx, createPanelHandlers(config), 'writer-toutiao: panel')
}

export { TOUTIAO_BRIEF }
export type { ToutiaoConfig } from './env.js'
