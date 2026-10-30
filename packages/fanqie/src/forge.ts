/**
 * forge 方法与规则脚本（inspiration-forge-suite 1.3.0：规划、拆书、写作与编辑）。
 * 方法原文一字不改，取用时在前面加一段对照表，把原文里的自有落盘指令换成本插件的长篇工具；
 * 五个检查脚本经 fanqie_bridge.py 统一成 JSON 契约，Python 只用标准库。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WriterError } from '../../host/src/index.js'
import { readText, resolveInside } from '../../core/src/fsx.js'
import { locatePython, runScript, type ScriptResult } from '../../core/src/runner.js'
import type { MethodLibrary } from '../../core/src/profiles.js'

let resolved: string | undefined

/** 插件自带的长篇 skill 目录：环境变量 → 打包后 <pkg>/skill-fanqie → 源码树 packages/fanqie/skill */
export function fanqieSkillDir(): string {
  if (resolved) return resolved
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.WRITER_FANQIE_SKILL_DIR,
    path.resolve(here, '../skill-fanqie'),
    path.resolve(here, '../skill'),
    path.resolve(here, '../../skill'),
    path.resolve(here, '../../../packages/fanqie/skill'),
    path.resolve(here, '../../../../packages/fanqie/skill'),
  ].filter((x): x is string => !!x)
  for (const c of candidates) {
    if (existsSync(path.join(c, 'scripts', 'fanqie_bridge.py'))) { resolved = c; return c }
  }
  throw new WriterError('NOT_FOUND', `找不到长篇 skill 目录（试过 ${candidates.join(' ; ')}）`)
}

export const fanqieBridgeScript = () => path.join(fanqieSkillDir(), 'scripts', 'fanqie_bridge.py')

/** 原文 → 长篇工具链 对照，写进每份方法的开头。 */
export const ADAPTER_NOTE = `> 【写作 Agent 适配】本文出自 inspiration-forge-suite 1.3.0，原文保留。在本插件里作品数据全部由长篇工具管理：
> 文中的自有目录（workspace/、chapters/、library/ 等）、init_project.py、archive_draft.py 等落盘指令**不要照做**，按下表换成工具：
>
> | 原文 | 本插件 |
> |---|---|
> | init_project.py / 建作品目录 | fanqie_project_create |
> | 写章纲文件 | fanqie_outline_set（字段对照见 fanqie_outline_check 的 field_map） |
> | 写草稿 / 出候选 | fanqie_chapter_brief → fanqie_candidate_stage → fanqie_candidate_accept |
> | archive_draft.py / 归档定稿 | fanqie_chapter_save status=final（需作者确认） |
> | 更新当前状态 / 已发生 | fanqie_foundation_append_happened |
> | check_outline.py | fanqie_outline_check |
> | ledger_check.py | fanqie_ledger_check |
> | manuscript_linter.py | fanqie_style_lint（已合并：语感雷达之后附 forge 正文体检） |
> | novel_scanner.py / quote_check.py | fanqie_library_scan / fanqie_quote_check |
> | 拆书卡入库 | fanqie_library_card_stage → fanqie_library_card_accept |
> | 编辑回报 | fanqie_review_report（四类硬伤 + L1–L3 固定格式） |
>
> 文中提到同套件的其他文件（如 references/writing.md、资产/幕转章纲.md），用 fanqie_forge_get 取：id = 套件名/相对路径去掉 .md，例如 novel-writer/references/writing；只写相对路径也能认出来。
`

const IGNORED = new Set(['LICENSE'])

/** 所有可取的方法 id：forge 下 .md 文件相对路径去掉扩展名 */
export async function listMethods(): Promise<string[]> {
  const root = path.join(fanqieSkillDir(), 'forge')
  const out: string[] = []
  async function walk(dir: string) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (e.name !== 'scripts') await walk(p) }
      else if (e.name.endsWith('.md') && !IGNORED.has(e.name)) out.push(path.relative(root, p).split(path.sep).join('/').replace(/\.md$/, ''))
    }
  }
  await walk(root)
  return out.sort()
}

/** 常用入口：给模型一个短目录，不必列全部 */
export const KEY_METHODS: Record<string, string> = {
  'inspiration-forge/SKILL': '开书规划总入口（题材、结构、幕纲、章纲）',
  'inspiration-forge/工作流': '规划工作流',
  'inspiration-forge/资产/幕转章纲': '幕纲拆成章纲',
  'inspiration-forge/资产/番茄平台': '番茄平台口径',
  'inspiration-forge-library/SKILL': '拆书入库总入口',
  'inspiration-forge-library/工作流': '拆书工作流',
  'novel-writer/SKILL': '正文写作总入口',
  'novel-writer/references/writing': '写章流程与交稿',
  'novel-writer/references/editor_method': '编辑审读：四类硬伤与 L1–L3',
  'novel-writer/references/continuity': '连续性与旧账',
  'novel-writer/references/rhythm': '节奏档位',
  'novel-writer/references/fanqie_platform': '番茄连载要点',
  'novel-writer/references/prose_craft': '句面与人味',
}

export async function getFanqieMethod(id: string): Promise<{ id: string; text: string }> {
  let clean = id.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\.md$/, '')
  if (!clean) throw new WriterError('INVALID_ARGS', '缺少方法 id')
  const root = path.join(fanqieSkillDir(), 'forge')
  let text = await readText(resolveInside(root, `${clean}.md`))
  if (text === undefined) {
    // 原文里常只写相对路径（references/writing.md）：唯一匹配时直接取
    const hits = (await listMethods()).filter(m => m.endsWith(`/${clean}`))
    if (hits.length === 1) { clean = hits[0]!; text = await readText(resolveInside(root, `${clean}.md`)) }
  }
  if (text === undefined) {
    const all = await listMethods()
    const near = all.filter(m => m.includes(clean.split('/').pop() ?? clean)).slice(0, 8)
    throw new WriterError('NOT_FOUND', `没有这份方法：${clean}。${near.length ? `相近的：${near.join('、')}` : `常用：${Object.keys(KEY_METHODS).join('、')}`}`)
  }
  return { id: clean, text: `${ADAPTER_NOTE}\n${text}` }
}

/* ---------------- 方法方案：默认（精炼版）/ 原版（forge 原件）/ 用户方案 ---------------- */

let defaultResolved: string | undefined

/** 长篇默认方案目录：环境变量 → 打包后 <pkg>/profiles/fanqie/default → 源码树 packages/fanqie/profiles/default */
export function fanqieDefaultDir(): string {
  if (defaultResolved) return defaultResolved
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.WRITER_FANQIE_DEFAULT_DIR,
    path.resolve(here, '../profiles/fanqie/default'),
    path.resolve(here, '../../profiles/default'),
    path.resolve(here, '../profiles/default'),
    path.resolve(here, '../../../packages/fanqie/profiles/default'),
    path.resolve(here, '../../../../packages/fanqie/profiles/default'),
  ].filter((x): x is string => !!x)
  for (const c of candidates) if (existsSync(path.join(c, 'profile.json'))) { defaultResolved = c; return c }
  throw new WriterError('NOT_FOUND', `找不到长篇默认方案目录（试过 ${candidates.join(' ; ')}）`)
}

interface DefaultIndex { methods: { id: string; title?: string }[]; aliases?: Record<string, string> }
let defaultIndex: DefaultIndex | undefined
/** 同步读（canonical 要同步）：默认方案的目录与"原版 id → 默认 id"别名 */
function loadDefaultIndex(): DefaultIndex {
  if (defaultIndex) return defaultIndex
  defaultIndex = JSON.parse(readFileSync(path.join(fanqieDefaultDir(), 'profile.json'), 'utf8')) as DefaultIndex
  return defaultIndex
}

/** 原版 id（含只写相对路径的写法）→ 默认方案 id */
export function fanqieCanonical(id: string): string {
  const idx = loadDefaultIndex()
  const clean = id.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\.md$/, '')
  if (idx.methods.some(m => m.id === clean)) return clean
  const aliases = idx.aliases ?? {}
  if (aliases[clean]) return aliases[clean]!
  const hits = Object.keys(aliases).filter(k => k.endsWith(`/${clean}`))
  return hits.length === 1 ? aliases[hits[0]!]! : clean
}

export const fanqieLibrary: MethodLibrary = {
  mode: 'fanqie',
  async defaultIds() { return loadDefaultIndex().methods.map(m => ({ id: m.id, title: m.title })) },
  originalIds: () => listMethods(),
  async readDefault(id) {
    const entry = loadDefaultIndex().methods.find(m => m.id === id)
    if (!entry) return undefined
    const text = await readText(resolveInside(fanqieDefaultDir(), `${id}.md`))
    return text === undefined ? undefined : { id, text, file: `默认/${id}.md`, title: entry.title }
  },
  async readOriginal(id) {
    try { const r = await getFanqieMethod(id); return { id: r.id, text: r.text, file: `${r.id}.md` } } catch { return undefined }
  },
  canonical: fanqieCanonical,
}

/* ---------------- 规则脚本 ---------------- */

export async function bridge(python: string | undefined, args: string[], opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<ScriptResult> {
  const py = await locatePython(python)
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

interface LintReport {
  cjk_chars?: number; para_count?: number; avg_para_chars?: number
  overlong_paragraphs?: [number, number, string][]
  long_para_threshold?: number
  ai_cliches?: { line: number; category: string; matched: string; context: string }[]
  dialogue_hits?: { line: number; category: string; matched: string }[]
}

const LONG_PARA = 160

/** forge manuscript_linter → 追加在语感雷达之后的 Markdown；与语感雷达已命中的片段重叠的套话不再重复列出 */
export interface LintExtra { source: string; text: string; hits: number }

export function renderForgeLint(r: LintReport, known: string[]): LintExtra {
  const overlaps = (m: string) => known.some(k => k && (k.includes(m) || m.includes(k)))
  const long = r.overlong_paragraphs ?? []
  const cliches = (r.ai_cliches ?? []).filter(c => !overlaps(c.matched))
  const skipped = (r.ai_cliches ?? []).length - cliches.length
  const dialogue = r.dialogue_hits ?? []
  const lines = [`- ${r.cjk_chars ?? 0} 字 · ${r.para_count ?? 0} 段 · 平均每段 ${r.avg_para_chars ?? 0} 字`]
  for (const [line, chars, head] of long.slice(0, 8)) lines.push(`- 超长段（第 ${line} 行，${chars} 字，手机上难读）：${head}`)
  for (const c of cliches.slice(0, 12)) lines.push(`- 第 ${c.line} 行【${c.category}】“${c.matched}”：${c.context}`)
  if (dialogue.length) lines.push(`- 台词里另有 ${dialogue.length} 处套话（人物口吻，通常保留）`)
  if (skipped) lines.push(`- 另有 ${skipped} 处与语感雷达重复，已省略`)
  if (!long.length && !cliches.length) lines.push('- 没有超长段，也没有语感雷达之外的套话')
  return { source: 'forge 正文体检', hits: long.length + cliches.length, text: lines.join('\n') }
}

/** fanqie_style_lint 之后追加的 forge 正文体检；known 为语感雷达已命中的片段 */
export async function forgeLint(python: string | undefined, input: { text: string; title?: string; known: string[] }): Promise<LintExtra | undefined> {
  const name = `${(input.title || '正文').replace(/[\\/:*?"<>|]/g, '_')}.md`
  const doc = input.title ? `# ${input.title}\n\n${input.text}` : input.text
  const r = await withTempFiles([{ name, text: doc }], (paths) => bridge(python, ['lint', String(LONG_PARA), ...paths], { timeoutMs: 30_000 }))
  const report = (r.reports as LintReport[] | undefined)?.[0]
  return report ? renderForgeLint(report, input.known) : undefined
}
