/** 今日头条模式的配置（dsh-writer 配置的 toutiao 段）。 */
export interface ToutiaoConfig {
  /** 相对会话 cwd 的数据目录，默认 outputs/toutiao */
  rootDir?: string
  /** 固定的绝对数据目录，设置后忽略 rootDir */
  storageRoot?: string
  /** Python 命令，如 C:\\Python312\\python.exe 或 "py -3" */
  python?: string
  /** 关闭的非锁定门禁 id */
  disabledGates?: string[]
  /** true：送“待验收”前当前版本必须出自编辑子代理或作者（写手与编辑分离），默认 false */
  requireEditorPass?: boolean
}

export type Issue = { message: string; path: (string | number)[] }
const STRINGS = ['rootDir', 'storageRoot', 'python'] as const
const KNOWN = new Set<string>([...STRINGS, 'requireEditorPass', 'disabledGates'])

/** 校验并填默认值；未知字段报错 */
export function parseToutiaoConfig(input: unknown, at: string[] = ['toutiao']): { value?: ToutiaoConfig; issues: Issue[] } {
  const issues: Issue[] = []
  if (input === undefined || input === null) input = {}
  if (typeof input !== 'object' || Array.isArray(input)) return { issues: [{ message: `${at.join('.')} 应为对象`, path: at }] }
  const v = input as Record<string, unknown>
  const out: ToutiaoConfig = {}
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
  out.rootDir ??= 'outputs/toutiao'
  return issues.length ? { issues } : { value: out, issues }
}
