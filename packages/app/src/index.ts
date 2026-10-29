import { writerHooks } from '../../zhizhang/dist/lib/writer-hooks.js'
import { openWork as selectWriterWork, worksRoot } from '../../fanqie/src/zhizhang.js'
import { bridge, withTempFiles } from '../../fanqie/src/env.js'
import { apply as applyZhizhang, Config as ZhizhangConfig } from '../../zhizhang/dist/index.js'
/**
 * dsh-writer — 写作 Agent 的 DSH 插件入口（体裁路由层，dev-plan T2.2）。
 *
 * 挂载时只注册两个触发工具：toutiao_enable（今日头条）、fanqie_enable（番茄长篇，建立在织章之上），
 * 以及本机写作台路由。普通会话不受打扰。
 *
 * 体裁隔离：一个会话一种体裁。全局 tools/pre-execute 拒绝另一体裁的工具；
 * 观察 zhizhang_enable 成功（tools/result）即认定该会话为番茄长篇，并自动挂上长篇门禁。
 */
import { promptWriterSession, onPreExecute, onToolResult, type HostContext, type HostToolExecution } from '../../dsh-adapter/src/index.js'
import { genres } from '../../core/src/genre.js'
import { apply as applyToutiao, type ToutiaoConfig } from '../../toutiao/src/index.js'
import { applyFanqie, isFanqieMounted, onZhizhangEnabled, type FanqieConfig } from '../../fanqie/src/index.js'

export const name = 'writer'
export const inject = ['tools']

export interface WriterConfig extends ToutiaoConfig {
  zhizhang?: Record<string, any>
  /** 番茄长篇设置 */
  fanqie?: FanqieConfig
}

/** Standard Schema（DSH 加载时校验） */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'writer',
    validate(input: unknown) {
      const v = (input ?? {}) as Record<string, unknown>
      if (typeof v !== 'object' || Array.isArray(v)) return { issues: [{ message: '插件配置必须是对象' }] }
      const issues: { message: string; path?: string[] }[] = []
      const strs = (o: Record<string, unknown>, keys: string[], at: string[] = []) => {
        for (const k of keys) if (o[k] !== undefined && typeof o[k] !== 'string') issues.push({ message: `${[...at, k].join('.')} 应为字符串`, path: [...at, k] })
      }
      const bools = (o: Record<string, unknown>, keys: string[], at: string[] = []) => {
        for (const k of keys) if (o[k] !== undefined && typeof o[k] !== 'boolean') issues.push({ message: `${[...at, k].join('.')} 应为布尔值`, path: [...at, k] })
      }
      const strArr = (o: Record<string, unknown>, k: string, at: string[] = []) => {
        if (o[k] !== undefined && !(Array.isArray(o[k]) && (o[k] as unknown[]).every(x => typeof x === 'string'))) issues.push({ message: `${[...at, k].join('.')} 应为字符串数组`, path: [...at, k] })
      }
      strs(v, ['rootDir', 'storageRoot', 'python'])
      bools(v, ['panel', 'requireEditorPass'])
      strArr(v, 'disabledGates')
      const zz = ZhizhangConfig['~standard'].validate(v.zhizhang ?? {})
      if (zz.issues) return { issues: zz.issues.map(i => ({ ...i, path: ['zhizhang', ...(i.path ?? [])] })) }
      const f = v.fanqie
      if (f !== undefined) {
        if (!f || typeof f !== 'object' || Array.isArray(f)) issues.push({ message: 'fanqie 应为对象', path: ['fanqie'] })
        else {
          const fo = f as Record<string, unknown>
          strs(fo, ['outputsDir', 'python'], ['fanqie'])
          bools(fo, ['autoMount', 'requireEditorPass'], ['fanqie'])
          strArr(fo, 'disabledGates', ['fanqie'])
          if (fo.zhizhang !== undefined) issues.push({message:'织章路径只在顶层 zhizhang 配置一次，请迁移 fanqie.zhizhang',path:['fanqie','zhizhang']})
          const z = fo.zhizhang
          if (z !== undefined) {
            if (!z || typeof z !== 'object' || Array.isArray(z)) issues.push({ message: 'fanqie.zhizhang 应为对象', path: ['fanqie', 'zhizhang'] })
            else strs(z as Record<string, unknown>, ['rootDir', 'storageRoot', 'worksRoot'], ['fanqie', 'zhizhang'])
          }
        }
      }
      if (issues.length) return { issues }
      return { value: { rootDir: 'outputs/toutiao', panel: true, ...v, fanqie: { outputsDir: 'outputs/fanqie', autoMount: true, ...(v.fanqie as object ?? {}) } } }
    },
  },
}

function isZhizhangEnabled(value: unknown): boolean {
  // 织章 0.20.0：成功回执以"已启用织章"开头；失败返回"错误[...]"字符串而非抛错
  return typeof value === 'string' ? value.startsWith('已启用织章') : false
}

export function apply(ctx: HostContext, config: WriterConfig = {}) {
  const { fanqie = {} as FanqieConfig, zhizhang = {}, ...toutiao } = config
  const checked = ZhizhangConfig['~standard'].validate(zhizhang)
  if (checked.issues) throw new Error('织章配置错误：' + checked.issues.map(i => i.message).join('；'))
  applyZhizhang(ctx, checked.value ?? zhizhang)
  const fanqieCfg: FanqieConfig = { ...fanqie, zhizhang: checked.value ?? zhizhang, python: fanqie.python ?? toutiao.python }
  writerHooks.requireEditorPass = fanqieCfg.requireEditorPass === true
  writerHooks.lint = async (text, hits) => {
    const result = await withTempFiles([{ name: '正文.md', text }], paths => bridge(fanqieCfg, ['lint', '160', ...paths]))
    const report = (result.reports as any[])[0]
    const own = [...(report.ai_cliches ?? []), ...(report.dialogue_hits ?? [])]
    const seen = new Set<string>()
    const unique = own.filter(h => {
      const key = `${h.line}:${h.matched}`
      if (seen.has(key)) return false
      seen.add(key)
      return !hits.some((x: any) => text.slice(0, x.start).split('\n').length === h.line && (String(x.text ?? x.match ?? x.snippet ?? '').includes(h.matched) || h.matched.includes(String(x.text ?? x.match ?? x.snippet ?? ''))))
    })
    return '\n\n## forge 正文体检（命中只供回看）\n' + `超长段：${report.overlong_paragraphs?.length ?? 0}；去重后套话：${unique.length}\n` + [...(report.overlong_paragraphs ?? []).map((p: any) => `- 第 ${p[0]} 行超长段：${p[1]} 字`), ...unique.map((h: any) => `- 第 ${h.line} 行 ${h.category}：${h.matched}`)].join('\n')
  }
  const recent = new Map<string, string>()
  writerHooks.dispatch = async action => {
    const session = recent.get(action.base)
    if (!session) throw new Error('本项目没有可投递的主会话；请先在主会话用织章打开这部作品')
    const command = {continue:'续写下一章', review:'派独立编辑子代理审读本章，先 fanqie_enable role=editor，再读取正文并回报 fanqie_review_report', revise:'按当前编辑回报修改，先核对回报是否过期，修改后重新审读'}[action.action]
    await promptWriterSession(ctx, session, `《${action.work}》当前章 ${action.chapter}：${command}。作品目录：${action.dir}。采纳和定稿仍须作者确认。`)
  }
  onToolResult(ctx, async (exec, ok, value) => {
    if (!ok || !exec.name.startsWith('zhizhang_') || typeof value === 'string' && value.startsWith('错误[')) return
    const agent = exec.agent
    if (!agent?.session?.id || agent.session.header?.origin === 'subagent' || agent.session.header?.parentSession || agent.ctx && isFanqieMounted(agent.ctx) === 'editor') return
    try {
      const args = exec.arguments as Record<string, any>
      const work = await selectWriterWork(worksRoot(fanqieCfg.zhizhang ?? {}, exec, args?.working_dir), args?.work)
      recent.set(work.base!, agent.session.id)
    } catch { /* No selected work; never send to an unrelated session. */ }
  })
  applyToutiao(ctx, toutiao)
  applyFanqie(ctx, fanqieCfg)
  onPreExecute(ctx, (exec: HostToolExecution) => genres.gate(exec))
  onToolResult(ctx, (exec, ok, value) => {
    if (!ok || exec.name !== 'zhizhang_enable' || !isZhizhangEnabled(value)) return
    try { genres.claim(exec, 'fanqie') } catch { return }
    onZhizhangEnabled(exec, fanqieCfg)
  })
}
