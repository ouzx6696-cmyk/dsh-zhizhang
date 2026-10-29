/**
 * 长篇方法库：inspiration-forge-suite 1.3.0 原文（inspiration-forge / inspiration-forge-library / novel-writer）。
 * 原文一字不改；取用时在前面加一段"写作 Agent 适配"说明，把原文里的自有落盘指令换成织章工具链（dev-plan T3.5）。
 */
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WriterError } from '../../dsh-adapter/src/index.js'
import { readText, resolveInside } from '../../core/src/fsx.js'

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

/** 原文 → 织章工具链 对照（T3.5）。写进每份方法的开头。 */
export const ADAPTER_NOTE = `> 【写作 Agent 适配】本文出自 inspiration-forge-suite 1.3.0，原文保留。在本插件里作品数据全部由织章管理：
> 文中的自有目录（workspace/、chapters/、library/ 等）、init_project.py、archive_draft.py 等落盘指令**不要照做**，按下表换成工具：
>
> | 原文 | 本插件 |
> |---|---|
> | init_project.py / 建作品目录 | zhizhang_project_create |
> | 写章纲文件 | zhizhang_outline_set（字段对照见 fanqie_outline_check 的 field_map） |
> | 写草稿 / 出候选 | zhizhang_chapter_brief → zhizhang_candidate_stage → zhizhang_candidate_accept |
> | archive_draft.py / 归档定稿 | zhizhang_chapter_save status=final（需作者确认） |
> | 更新当前状态 / 已发生 | zhizhang_foundation_append_happened |
> | check_outline.py | fanqie_outline_check |
> | ledger_check.py | fanqie_ledger_check |
> | manuscript_linter.py | zhizhang_style_lint（织章雷达 + forge 正文体检，重复命中自动去重） |
> | novel_scanner.py / quote_check.py | fanqie_library_scan / fanqie_quote_check |
> | 拆书卡入库 | zhizhang_library_card_stage → zhizhang_library_card_accept |
> | 编辑回报 | fanqie_review_report（四类硬伤 + L1–L3 固定格式） |
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
  const clean = id.trim().replace(/\.md$/, '')
  if (!clean) throw new WriterError('INVALID_ARGS', '缺少方法 id')
  const root = path.join(fanqieSkillDir(), 'forge')
  const file = resolveInside(root, `${clean}.md`)
  const text = await readText(file)
  if (text === undefined) {
    const all = await listMethods()
    const near = all.filter(m => m.includes(clean.split('/').pop() ?? clean)).slice(0, 8)
    throw new WriterError('NOT_FOUND', `没有这份方法：${clean}。${near.length ? `相近的：${near.join('、')}` : `常用：${Object.keys(KEY_METHODS).join('、')}`}`)
  }
  return { id: clean, text: `${ADAPTER_NOTE}\n${text}` }
}
