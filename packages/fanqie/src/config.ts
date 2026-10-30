/** 番茄长篇模式的配置（dsh-writer 配置的 fanqie 段）：数据位置、Python、定稿条件、门禁开关、多草稿。 */
import type { PluginConfig } from './engine/types.js'

export interface FanqieConfig extends PluginConfig {
  /** 数据目录（相对会话 cwd），默认 .writer */
  rootDir?: string
  /** 固定数据根（绝对路径）；也认 WRITER_NOVEL_ROOT */
  storageRoot?: string
  /** 作品目录，默认 <数据根>/works；也认 WRITER_NOVEL_WORKS */
  worksRoot?: string
  /** 共享拆书库，默认 <数据根>/library；也认 WRITER_NOVEL_LIBRARY */
  libraryRoot?: string
  /** 本地书源目录；也认 WRITER_NOVEL_SOURCE_ROOT */
  sourceRoot?: string
  /** Python 命令；不填用顶层 python */
  python?: string
  /** true：定稿前当前正文必须有一份"通过"且版本匹配的编辑审读回报（对话与写作台都受约束） */
  requireEditorPass?: boolean
  /** 关闭的非锁定门禁 id */
  disabledGates?: string[]
  /** 同章多草稿统一整理，默认关 */
  multiDraft?: { enabled?: boolean }
}

export type Issue = { message: string; path: (string | number)[] }

const STRINGS = ['rootDir', 'storageRoot', 'worksRoot', 'libraryRoot', 'sourceRoot', 'python'] as const
const KNOWN = new Set<string>([...STRINGS, 'requireEditorPass', 'disabledGates', 'multiDraft'])

/** 校验并填默认值；未知字段报错，免得拼错的配置悄悄不生效 */
export function parseFanqieConfig(input: unknown, at: string[] = ['fanqie']): { value?: FanqieConfig; issues: Issue[] } {
  const issues: Issue[] = []
  if (input === undefined || input === null) input = {}
  if (typeof input !== 'object' || Array.isArray(input)) return { issues: [{ message: `${at.join('.')} 应为对象`, path: at }] }
  const v = input as Record<string, unknown>
  const out: FanqieConfig = {}
  for (const k of Object.keys(v)) if (!KNOWN.has(k)) issues.push({ message: `${[...at, k].join('.')} 不是有效配置项`, path: [...at, k] })
  for (const k of STRINGS) {
    const x = v[k]
    if (x === undefined) continue
    if (typeof x !== 'string') issues.push({ message: `${[...at, k].join('.')} 应为字符串`, path: [...at, k] })
    else if (x.trim()) out[k] = x.trim()
  }
  if (v.requireEditorPass !== undefined) {
    if (typeof v.requireEditorPass !== 'boolean') issues.push({ message: `${[...at, 'requireEditorPass'].join('.')} 应为布尔值`, path: [...at, 'requireEditorPass'] })
    else out.requireEditorPass = v.requireEditorPass
  }
  if (v.disabledGates !== undefined) {
    if (!(Array.isArray(v.disabledGates) && v.disabledGates.every(x => typeof x === 'string'))) issues.push({ message: `${[...at, 'disabledGates'].join('.')} 应为字符串数组`, path: [...at, 'disabledGates'] })
    else out.disabledGates = v.disabledGates as string[]
  }
  if (v.multiDraft !== undefined) {
    const m = v.multiDraft as Record<string, unknown> | null
    if (!m || typeof m !== 'object' || Array.isArray(m) || (m.enabled !== undefined && typeof m.enabled !== 'boolean')) issues.push({ message: `${[...at, 'multiDraft'].join('.')} 应为 { enabled: 布尔值 }`, path: [...at, 'multiDraft'] })
    else out.multiDraft = { enabled: m.enabled === true }
  }
  out.rootDir ??= '.writer'
  return issues.length ? { issues } : { value: out, issues }
}
