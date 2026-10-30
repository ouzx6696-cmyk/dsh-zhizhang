/**
 * dsh-writer —— 写作 Agent 的 DSH 插件入口。
 *
 * 宿主上只注册一个工具 writer_enable，外加侧栏「写作台」的接口。作者要写作时，Agent 调用
 * writer_enable(mode, role)，本会话才挂上对应模式的工具、规则与门禁：
 *   - mode=toutiao：今日头条（packages/toutiao）
 *   - mode=fanqie ：番茄长篇（packages/fanqie）
 *   - role=editor ：编辑子代理（头条只挂红笔/质检；长篇写入类工具一律拒绝）
 * 一个会话一种模式；全局门禁拒绝另一模式的工具。
 */
import {
  agentContextOf, defineWriterTool, onPreExecute, provideSessionPrompt, WriterError,
  type HostContext, type HostToolDefinition,
} from '../../host/src/index.js'
import { MODE_LABEL, MODES, modes, type Mode } from '../../core/src/mode.js'
import { setPromptSink } from '../../core/src/sessions.js'
import { setProfilesRoot } from '../../core/src/profiles.js'
import { profileRoutes } from '../../core/src/profile-api.js'
import { API, registerWorkbench, type WorkbenchAccess, type WorkbenchMode } from '../../workbench/src/server.js'
import {
  mountToutiao, parseToutiaoConfig, toutiaoApi, toutiaoLibrary, toutiaoNext, TOUTIAO_BRIEF, TOUTIAO_EDITOR_BRIEF,
  type Role, type ToutiaoConfig,
} from '../../toutiao/src/index.js'
import {
  configureFanqie, fanqieApi, fanqieLibrary, fanqieNext, mountFanqie, parseFanqieConfig, FANQIE_BRIEF, FANQIE_EDITOR_BRIEF,
  type FanqieConfig,
} from '../../fanqie/src/index.js'

export const name = 'writer'
export const inject = ['tools']

export interface WriterConfig {
  /** Python 命令，两种模式共用；默认自动查找 py -3 / python / python3 */
  python?: string
  toutiao?: ToutiaoConfig
  fanqie?: FanqieConfig
  workbench?: WorkbenchAccess
  /** 方法方案（用户方案与当前选择）存放目录；默认 $DSH_HOME/writer/profiles */
  profilesDir?: string
}

type Issue = { message: string; path: (string | number)[] }

function parseAccess(input: unknown): { value?: WorkbenchAccess; issues: Issue[] } {
  if (input === undefined || input === null) return { value: {}, issues: [] }
  if (typeof input !== 'object' || Array.isArray(input)) return { issues: [{ message: 'workbench 应为对象', path: ['workbench'] }] }
  const v = input as Record<string, unknown>
  const issues: Issue[] = []
  for (const k of Object.keys(v)) if (!['allowLan', 'hosts', 'token'].includes(k)) issues.push({ message: `workbench.${k} 不是有效配置项`, path: ['workbench', k] })
  if (v.allowLan !== undefined && typeof v.allowLan !== 'boolean') issues.push({ message: 'workbench.allowLan 应为布尔值', path: ['workbench', 'allowLan'] })
  if (v.token !== undefined && typeof v.token !== 'string') issues.push({ message: 'workbench.token 应为字符串', path: ['workbench', 'token'] })
  if (v.hosts !== undefined && !(Array.isArray(v.hosts) && v.hosts.every(x => typeof x === 'string'))) issues.push({ message: 'workbench.hosts 应为字符串数组', path: ['workbench', 'hosts'] })
  return issues.length ? { issues } : { value: v as WorkbenchAccess, issues }
}

/** Standard Schema（DSH 加载插件时校验 config 并填默认值） */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'writer',
    validate(input: unknown) {
      const v = (input ?? {}) as Record<string, unknown>
      if (typeof v !== 'object' || Array.isArray(v)) return { issues: [{ message: '插件配置必须是对象' }] }
      const issues: Issue[] = []
      for (const k of Object.keys(v)) if (!['python', 'toutiao', 'fanqie', 'workbench', 'profilesDir'].includes(k)) issues.push({ message: `${k} 不是有效配置项：只认 python、toutiao、fanqie、workbench、profilesDir（见 INSTALL.md）`, path: [k] })
      if (v.python !== undefined && typeof v.python !== 'string') issues.push({ message: 'python 应为字符串', path: ['python'] })
      if (v.profilesDir !== undefined && typeof v.profilesDir !== 'string') issues.push({ message: 'profilesDir 应为字符串', path: ['profilesDir'] })
      const t = parseToutiaoConfig(v.toutiao), f = parseFanqieConfig(v.fanqie), w = parseAccess(v.workbench)
      issues.push(...t.issues, ...f.issues, ...w.issues)
      if (issues.length) return { issues }
      return { value: { ...v, toutiao: t.value, fanqie: f.value, workbench: w.value } }
    },
  },
}

function makeWriterEnable(host: HostContext, toutiao: ToutiaoConfig, fanqie: FanqieConfig): HostToolDefinition {
  return defineWriterTool<{ mode?: string; role?: string }>({
    name: 'writer_enable',
    description: '【按需启用写作 Agent】作者要写作时调用，把对应模式的工具、规则与门禁加载到当前会话。mode=toutiao：今日头条图文/微头条（找热点、立项、标题、去 AI 味、质检、交稿）；mode=fanqie：番茄长篇网文（开书、章纲、续写、审读定稿、拆书）。一个会话只能一种模式。编辑子代理传 role=editor。',
    properties: {
      mode: { type: 'string', enum: MODES, description: 'toutiao=今日头条；fanqie=番茄长篇' },
      role: { type: 'string', enum: ['writer', 'editor'], description: 'writer=主写手（默认）；editor=编辑子代理，只审不定稿' },
    },
    required: ['mode'],
    async run(args, exec) {
      const agentCtx = agentContextOf(exec)
      if (!agentCtx) throw new WriterError('NO_AGENT', '当前调用没有 Agent 作用域，无法按会话启用；请在新会话重试')
      const mode = args.mode as Mode
      if (!MODES.includes(mode)) throw new WriterError('INVALID_ARGS', 'mode 只能是 toutiao（今日头条）或 fanqie（番茄长篇）')
      const role: Role = args.role === 'editor' ? 'editor' : 'writer'
      modes.claim(exec, mode)
      const common = { enabled: true, mode, role, workbench: role === 'editor' ? undefined : `侧栏「写作台」→ ${MODE_LABEL[mode]}` }
      if (mode === 'toutiao') {
        const r = mountToutiao(agentCtx, toutiao, host, role)
        return {
          ...common,
          already_enabled: r.tools.length === 0,
          tool_count: r.tools.length || undefined,
          prompt_section: r.promptSection,
          gates: r.gates,
          brief: r.promptSection ? undefined : role === 'editor' ? TOUTIAO_EDITOR_BRIEF : TOUTIAO_BRIEF,
          next: toutiaoNext(role),
        }
      }
      const r = mountFanqie(agentCtx, fanqie, role)
      return {
        ...common,
        already_enabled: !r.fresh && r.tools.length === 0,
        engine: r.engine,
        tool_count: r.tools.length || undefined,
        prompt_section: r.promptSection,
        gates: r.gates,
        brief: r.promptSection ? undefined : role === 'editor' ? FANQIE_EDITOR_BRIEF : FANQIE_BRIEF,
        next: fanqieNext(role),
      }
    },
  })
}

export function apply(ctx: HostContext, config: WriterConfig = {}) {
  const toutiao: ToutiaoConfig = { ...(parseToutiaoConfig(config.toutiao).value ?? config.toutiao ?? {}) }
  const fanqie: FanqieConfig = { ...(parseFanqieConfig(config.fanqie).value ?? config.fanqie ?? {}) }
  toutiao.python ??= config.python
  fanqie.python ??= config.python
  configureFanqie(fanqie)
  setProfilesRoot(config.profilesDir)
  ctx.tools?.register(makeWriterEnable(ctx, toutiao, fanqie))
  onPreExecute(ctx, exec => modes.gate(exec))
  const profiles: WorkbenchMode[] = [
    profileRoutes(`${API}/toutiao`, toutiaoLibrary, () => toutiao.profile),
    profileRoutes(`${API}/fanqie`, fanqieLibrary, () => fanqie.profile),
  ]
  registerWorkbench(ctx, config.workbench ?? {}, [toutiaoApi(toutiao), fanqieApi(fanqie), ...profiles])
  provideSessionPrompt(ctx, sink => setPromptSink(sink), 'dsh-writer: workbench delivery')
}
