import { assertResourceId } from '../../zhizhang/dist/lib/storage/primitives.js'
/** 长篇运行环境：配置、Python 桥、审读回报存储。 */
import path from 'node:path'
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { sessionCwd, WriterError, type HostToolExecution } from '../../dsh-adapter/src/index.js'
import { atomicWrite, readJson, resolveInside } from '../../core/src/fsx.js'
import { locatePython, runScript, type ScriptResult } from '../../core/src/runner.js'
import { fanqieBridgeScript } from './methods.js'
import { openWork, worksRoot, type ZhizhangPathsConfig } from './zhizhang.js'

export interface FanqieConfig {
  /** 本插件自己的输出目录（审读回报等），相对会话 cwd，默认 outputs/fanqie */
  outputsDir?: string
  /** Python 命令；不填沿用顶层 python */
  python?: string
  /** 织章存储位置；和织章插件配置保持一致（都不填 = <会话 cwd>/.zhizhang） */
  zhizhang?: ZhizhangPathsConfig
  /** 观察到 zhizhang_enable 成功时，自动给该会话挂上长篇工具与门禁，默认 true */
  autoMount?: boolean
  /** true：定稿前当前正文必须有一份"通过"且版本匹配的编辑审读回报，默认 false */
  requireEditorPass?: boolean
  /** 关闭的非锁定门禁 id */
  disabledGates?: string[]
}

export function outputsRoot(config: FanqieConfig, exec?: HostToolExecution): string {
  return path.resolve(sessionCwd(exec), config.outputsDir?.trim() || 'outputs/fanqie')
}

export async function bridge(config: FanqieConfig, args: string[], opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ScriptResult> {
  const py = await locatePython(config.python)
  const r = await runScript(py, fanqieBridgeScript(), args, { timeoutMs: opts.timeoutMs ?? 120_000, signal: opts.signal })
  if (!r.ok) {
    const code = r.code === 'NOT_FOUND' ? 'NOT_FOUND' : r.code === 'INVALID_ARGS' ? 'INVALID_ARGS' : 'SCRIPT_FAILED'
    throw new WriterError(code, String(r.message ?? '长篇规则脚本失败'))
  }
  return r
}

/** 把若干段文本写进临时目录（文件名即对照表里的来源名），用完删除 */
export async function withTempFiles<T>(files: { name: string; text: string }[], fn: (paths: string[]) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'writer-fanqie-'))
  try {
    const paths: string[] = []
    for (const f of files) {
      const p = resolveInside(dir, f.name.replace(/[\\/:*?"<>|]/g, '_'))
      await writeFile(p, f.text, 'utf8')
      paths.push(p)
    }
    return await fn(paths)
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

/* ---------------- 审读回报 ---------------- */

export const HARD_CATEGORIES = ['关键剧情与落点', '本书硬约束', '人物认知', '正文接续'] as const
export const LEVELS = ['L1', 'L2', 'L3'] as const
export const VERDICTS = ['通过', '未通过', '结构性冲突'] as const

export interface ReviewReport {
  work: string
  work_title: string
  chapter: string
  chapter_title: string
  /** 审读时正文的 SHA-256；正文一改，这份回报就过期 */
  body_sha256: string
  verdict: typeof VERDICTS[number]
  hard_issues: { category: string; location: string; basis: string; impact?: string; fix: string }[]
  levels: { level: string; location: string; symptom: string; fix: string }[]
  optional: string[]
  reread_full: boolean
  changed_scope: string
  strengths: string
  by: 'editor' | 'writer'
  at: string
}

export async function reviewDir(config: FanqieConfig, exec: HostToolExecution | undefined, work: string, chapter: string, workDir?: string): Promise<string> {
  const dir = workDir ?? (await openWork(worksRoot(config.zhizhang ?? {}, exec), work)).dir
  return resolveInside(dir, 'writer-reviews', assertResourceId(chapter, '章节 id'))
}

export async function saveReview(config: FanqieConfig, exec: HostToolExecution | undefined, r: ReviewReport, workDir?: string): Promise<string> {
  const dir = await reviewDir(config, exec, r.work, r.chapter, workDir)
  const file = path.join(dir, `${r.at.replace(/[:.+]/g, '-')}.json`)
  await atomicWrite(file, JSON.stringify(r, null, 2))
  return file
}

export async function latestReview(config: FanqieConfig, exec: HostToolExecution | undefined, work: string, chapter: string, workDir?: string): Promise<ReviewReport | undefined> {
  const dir = await reviewDir(config, exec, work, chapter, workDir)
  let names: string[] = []
  try { names = (await readdir(dir)).filter(n => n.endsWith('.json')).sort() } catch { return undefined }
  const last = names.at(-1)
  return last ? readJson<ReviewReport>(path.join(dir, last)) : undefined
}

export function renderReview(r: ReviewReport, stale = false): string {
  const lines = [
    `## 审读回报 · 《${r.work_title}》${r.chapter_title}`,
    `- 结论：**${r.verdict}**${stale ? '（⚠ 正文已改，回报过期）' : ''}`,
    `- 是否完整回读：${r.reread_full ? '是' : '否'}；实际改动范围：${r.changed_scope || '未改'}`,
  ]
  if (r.strengths) lines.push(`- 主要长处：${r.strengths}`)
  lines.push('', '### 四类硬伤')
  if (!r.hard_issues.length) lines.push('无。')
  for (const h of r.hard_issues) lines.push(`- 【${h.category}】${h.location}：${h.basis}${h.impact ? `；影响：${h.impact}` : ''} → ${h.fix}`)
  lines.push('', '### L1–L3 定位')
  if (!r.levels.length) lines.push('无。')
  for (const l of r.levels) lines.push(`- ${l.level} ${l.location}：${l.symptom} → ${l.fix}`)
  if (r.optional.length) lines.push('', '### 可选建议', ...r.optional.map(o => `- ${o}`))
  return lines.join('\n')
}
