import { Tasks, TASK_BRIEF, type ReviewMode } from './tasks.js'
import { taskPanel } from './task-panel.js'
import { addPromptSection, registerRoutes, sessionCwd, enableIntegratedZhizhang } from '../../dsh-adapter/src/index.js'
import { writerHooks } from '../../zhizhang/dist/lib/writer-hooks.js'
import { openWork as selectWriterWork, worksRoot } from '../../fanqie/src/zhizhang.js'
import { bridge, withTempFiles } from '../../fanqie/src/env.js'
import { apply as applyZhizhang, Config as ZhizhangConfig, makeEnableTool } from '../../zhizhang/dist/index.js'
/**
 * dsh-writer — 写作 Agent 的 DSH 插件入口。
 *
 * 挂载时只注册两个触发工具：toutiao_enable（今日头条）、fanqie_enable（番茄长篇，建立在织章之上），
 * 以及本机写作台路由。普通会话不受打扰。
 *
 * 体裁隔离：一个会话一种体裁。全局 tools/pre-execute 拒绝另一体裁的工具；
 * 观察 zhizhang_enable 成功（tools/result）即认定该会话为番茄长篇，并自动挂上长篇门禁。
 */
import { promptWriterSession, onPreExecute, onToolResult, type HostContext, type HostToolDefinition, type HostToolExecution } from '../../dsh-adapter/src/index.js'
import { genres } from '../../core/src/genre.js'
import { apply as applyToutiao, type ToutiaoConfig } from '../../toutiao/src/index.js'
import { applyFanqie, isFanqieMounted, onZhizhangEnabled, type FanqieConfig } from '../../fanqie/src/index.js'

export const name = 'writer'
export const inject = ['tools']

export interface WriterConfig extends ToutiaoConfig {
  zhizhang?: Record<string, any>
  compatibilityEntry?: boolean
  workflow?: { review?: ReviewMode; maxAutoRevisionRounds?: number }
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
      bools(v, ['panel', 'requireEditorPass', 'compatibilityEntry'])
      if (v.workflow !== undefined) {
        const w = v.workflow as Record<string, unknown>
        if (!w || typeof w !== 'object' || Array.isArray(w)) issues.push({message:'workflow 应为对象'})
        else {
          if (w.review !== undefined && !['quick','editor','manual'].includes(String(w.review))) issues.push({message:'workflow.review 应为 quick/editor/manual'})
          if (w.maxAutoRevisionRounds !== undefined && (!Number.isInteger(w.maxAutoRevisionRounds) || Number(w.maxAutoRevisionRounds)<0 || Number(w.maxAutoRevisionRounds)>5)) issues.push({message:'自动返修轮数应为 0–5 整数'})
        }
      }
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
      return { value: { rootDir: 'outputs/toutiao', panel: true, ...v, fanqie: { autoMount: true, ...(v.fanqie as object ?? {}) } } }
    },
  },
}

function isZhizhangEnabled(value: unknown): boolean {
  // 织章 0.20.0：成功回执以"已启用织章"开头；失败返回"错误[...]"字符串而非抛错
  return typeof value === 'string' ? value.startsWith('已启用织章') : false
}

export function apply(ctx: HostContext, config: WriterConfig = {}) {
  const { fanqie = {} as FanqieConfig, zhizhang = {}, workflow, compatibilityEntry = false, ...toutiao } = config
  const checked = ZhizhangConfig['~standard'].validate(zhizhang)
  if (checked.issues) throw new Error('织章配置错误：' + checked.issues.map(i => i.message).join('；'))
  applyZhizhang(ctx, checked.value ?? zhizhang, { compatibilityEntry })
  const fanqieCfg: FanqieConfig = { ...fanqie, enableWorkbench: exec => enableIntegratedZhizhang(
    exec, compatibilityEntry ? undefined : makeEnableTool(checked.value ?? zhizhang) as unknown as HostToolDefinition,
  ), zhizhang: checked.value ?? zhizhang, python: fanqie.python ?? toutiao.python }
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
  const tasks = new Tasks({ toutiao, fanqie: fanqieCfg, workflow })
  onPreExecute(ctx, exec => tasks.guard(exec))
  const mountedTasks = new WeakSet<object>()
  const recent = new Map<string, Map<string, string>>()
  const pendingSelections = new Set<Promise<void>>()
  writerHooks.dispatch = async action => {
    // tools/result is asynchronous; wait for selections that were already reported.
    await Promise.all([...pendingSelections])
    const available = recent.get(action.dir)
    if (!available?.size) throw new Error('本作品没有可投递的主会话；请先在主会话用番茄打开这部作品')
    if (available.size > 1) throw new Error('本作品对应多个主会话；请到写作任务页明确选择会话后继续。')
    const [session, cwd] = [...available][0]!
    const exec = { name: 'writer_panel', arguments: {}, agent: { session: { id: session, header: { cwd } } } }
    const goal = {continue:'续写下一章',review:'派独立编辑子代理审读本章',revise:'按有效编辑回报定点修改本章'}[action.action]
    let chapter = action.chapter
    if (action.action === 'continue') {
      const work = await selectWriterWork(worksRoot(fanqieCfg.zhizhang ?? {}, exec, action.base), action.work)
      if (work.dir !== action.dir) throw new Error('当前项目中的作品目录已变化，请重新选择作品。')
      const index = work.chapters.findIndex(c => c.id === action.chapter)
      if (index < 0) throw new Error('当前章节不在作品目录中，请刷新后重试。')
      const next = work.chapters[index + 1]
      if (next) chapter = next.id
      else {
        let number = Math.max(0, ...work.chapters.map(c => c.position)) + 1
        while (work.chapters.some(c => c.id === `c${String(number).padStart(3,'0')}`)) number++
        chapter = `c${String(number).padStart(3,'0')}`
      }
    }
    const t = await tasks.run(exec, 'fanqie', { goal, intent: action.action === 'continue' ? 'continue' : action.action, work: action.work, chapter, working_dir: action.base, review:action.action === 'review'?'editor':undefined })
    try {
      await promptWriterSession(ctx,session,`《${action.work}》${goal}。恢复任务 ${t.id}，先 writer_resume(task_id="${t.id}")，按返回写作包和 next 执行。目标章节 ${t.target.chapter}，作品目录 ${action.dir}。采纳和定稿仍须作者确认。`)
    } catch (e) {
      await tasks.dispatchFailed(t,e)
      throw e
    }
    return { taskId: t.id, url: `/writer?cwd=${encodeURIComponent(t.cwd)}&id=${t.id}` }
  }
  if (config.panel !== false) registerRoutes(ctx, taskPanel(tasks,ctx), 'writer: tasks')
  onToolResult(ctx, (exec, ok, value) => {
    if (!ok || !['toutiao_enable','fanqie_enable','zhizhang_enable'].includes(exec.name)) return
    if (typeof value === 'object' && value && (value as any).ok === false || typeof value === 'string' && !isZhizhangEnabled(value)) return
    if (exec.name === 'zhizhang_enable' && fanqieCfg.autoMount === false) return
    const agentCtx = exec.agent?.ctx
    const args = exec.arguments as Record<string, unknown>
    if (!agentCtx || args?.role === 'editor' || isFanqieMounted(agentCtx) === 'editor' || exec.agent?.session?.header?.origin === 'subagent' || exec.agent?.session?.header?.parentSession) return
    const mode = exec.name === 'toutiao_enable' ? 'toutiao' : 'fanqie'
    tasks.bind(exec,mode)
    if (mountedTasks.has(agentCtx)) return
    for (const tool of tasks.tools(mode)) agentCtx.tools?.register(tool)
    addPromptSection(agentCtx,'writer:task',115,()=>TASK_BRIEF)
    mountedTasks.add(agentCtx)
  })
  onToolResult(ctx, (exec, ok, value) => {
    if (!ok || !exec.name.startsWith('zhizhang_') || typeof value === 'string' && value.startsWith('错误')) return
    const args = exec.arguments as Record<string, any>
    if (!['zhizhang_project_open','zhizhang_project_create'].includes(exec.name) && typeof args?.work !== 'string') return
    const agent = exec.agent
    if (!agent?.session?.id || agent.session.header?.origin === 'subagent' || agent.session.header?.parentSession || agent.ctx && isFanqieMounted(agent.ctx) === 'editor') return
    const selection = (async () => {
      try {
        const work = await selectWriterWork(worksRoot(fanqieCfg.zhizhang ?? {}, exec, args?.working_dir), args?.work)
        const available = recent.get(work.dir) ?? new Map<string,string>()
        available.set(agent.session!.id!, sessionCwd(exec))
        recent.set(work.dir, available)
      } catch { /* No selected work; never send to an unrelated session. */ }
    })()
    pendingSelections.add(selection)
    void selection.finally(() => pendingSelections.delete(selection))
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
