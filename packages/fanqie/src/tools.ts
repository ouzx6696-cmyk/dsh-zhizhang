/** 写作层工具：forge 方法、章纲检查、旧账对照、拆书测绘、引文核对、编辑审读回报。只读作品，不写正文。 */
import path from 'node:path'
import { stat } from 'node:fs/promises'
import { defineWriterTool, sessionCwd, WriterError, type HostToolDefinition, type HostToolExecution, type JsonSchemaNode } from '../../host/src/index.js'
import { nowIso, resolveInside } from '../../core/src/fsx.js'
import { bridge, fanqieLibrary, KEY_METHODS, listMethods, withTempFiles } from './forge.js'
import { activeProfile, profileDetail, readMethod } from '../../core/src/profiles.js'
import { createProfileTool } from '../../core/src/profile-tool.js'
import { HARD_CATEGORIES, latestReview, LEVELS, renderReview, saveReview, VERDICTS, type ReviewReport } from './review.js'
import { openWork, pickChapters, readChapter, type ChapterRecord } from './works.js'
import type { FanqieConfig } from './config.js'
import { getUserAsset, listUserAssets, USER_PREFIX } from '../../core/src/user-assets.js'

export type Role = 'writer' | 'editor'

const S = (description: string): JsonSchemaNode => ({ type: 'string', description })
const I = (description: string): JsonSchemaNode => ({ type: 'integer', description })
const B = (description: string): JsonSchemaNode => ({ type: 'boolean', description })
const E = (values: readonly string[], description: string): JsonSchemaNode => ({ type: 'string', enum: [...values], description })
const WORK = S('长篇作品 key 或标题；只有一部作品时可省略')
const CHAPTERS = S('章节：章 id / 序号，或区间如 "3-5"；省略 = 全部')
const CHAPTER = S('章 id、标题或序号')

const str = (v: unknown) => (typeof v === 'string' ? v : '')

/** 编辑角色可见的长篇工具 */
export const EDITOR_TOOLS = new Set([
  'fanqie_forge_get', 'fanqie_outline_check', 'fanqie_ledger_check',
  'fanqie_review_report', 'fanqie_review_get', 'fanqie_quote_check', 'fanqie_library_scan',
])

export interface FanqieToolDeps { config: FanqieConfig; role: Role }

const work = (exec: HostToolExecution, key?: string) => openWork(exec, key || undefined)

/** 本地文件路径只允许在会话工作目录内 */
async function localFile(exec: HostToolExecution, p: string): Promise<string> {
  if (!p.trim()) throw new WriterError('INVALID_ARGS', '缺少文件路径')
  const cwd = sessionCwd(exec)
  const abs = resolveInside(cwd, p)
  const st = await stat(abs).catch(() => undefined)
  if (!st?.isFile()) throw new WriterError('NOT_FOUND', `文件不存在：${p}`)
  return abs
}

function outlineText(ch: ChapterRecord): string {
  const o = ch.outline
  return [
    `# ${ch.title} 章纲`,
    o.synopsis && `剧情梗概：${o.synopsis}`,
    o.conflict && `核心冲突与看点：${o.conflict}`,
    o.beats && `情节推进节点：${o.beats}`,
    o.ending && `章末落点：${o.ending}`,
    o.locks && `锁定事实：${o.locks}`,
  ].filter(Boolean).join('\n')
}

export function createFanqieTools(deps: FanqieToolDeps): HostToolDefinition[] {
  const { config } = deps
  const tools: HostToolDefinition[] = [
    defineWriterTool<{ id?: string }>({
      name: 'fanqie_forge_get',
      description: '取长篇方法（规划、拆书、写章、句面、节奏、连续性、编辑、修订、模板与示范），按当前方法方案读取（默认 / 原版 / 用户方案，见 fanqie_profile）。不给 id 返回当前方案目录；"list" 返回全部 id（含作者自备的 user:… 资产）。原版的 forge id（如 novel-writer/references/editor_method）会自动对应到默认方案里的同类方法；原版:id 强制读原件（原件前附工具对照表，落盘一律走长篇工具）。作者自备资产只作参考，与门禁冲突时以门禁为准。',
      properties: { id: S('方法 id，如 write-chapter、edit；作者自备用 user:相对路径；省略看当前方案目录，"list" 看全部') },
      async run(args, exec) {
        const id = str(args.id).trim()
        const cwd = sessionCwd(exec)
        const act = await activeProfile('fanqie', config.profile)
        if (!id) {
          if (act.id === 'original' || (act.kind === 'user' && act.base === 'original')) return { profile: act.name, key_methods: KEY_METHODS }
          const d = await profileDetail(fanqieLibrary, act.id, config.profile)
          return { profile: act.name, key_methods: Object.fromEntries(d.methods.map(m => [m.id, m.title ?? (m.added ? '作者新增' : '')])) }
        }
        if (id === 'list') {
          const d = await profileDetail(fanqieLibrary, act.id, config.profile)
          const user = await listUserAssets(config.assets, cwd)
          return {
            profile: act.name, profile_id: act.id,
            methods: d.methods.map(m => m.id), original: act.id === 'original' ? undefined : await listMethods(),
            user: user.assets.map(a => ({ id: a.id, file: `${a.dir}/${a.file}`, bytes: a.bytes })), warnings: user.warnings,
          }
        }
        if (id.startsWith(USER_PREFIX)) return { ...(await getUserAsset(config.assets, cwd, id)), source: 'user' }
        return { ...(await readMethod(fanqieLibrary, undefined, id, config.profile)) }
      },
    }),

    defineWriterTool<{ work?: string; chapters?: string; mode?: string }>({
      name: 'fanqie_outline_check',
      description: '章纲机械检查：长篇章纲 8 个字段（剧情梗概、核心冲突与看点、情节推进节点、章末落点、视角、目标篇幅、锁定事实、人物知识边界）是否填齐、有没有显式占位、章序是否连续。readiness=动笔前（默认），format=只查接口。不判断剧情好坏。',
      properties: { work: WORK, chapters: CHAPTERS, mode: E(['readiness', 'format'], '默认 readiness') },
      async run(args, exec) {
        const w = await work(exec, args.work)
        const rows = pickChapters(w, args.chapters)
        const chapters = []
        for (const r of rows) {
          const ch = await readChapter(w, r.id)
          chapters.push({ id: ch.id, title: ch.title, position: ch.position, status: ch.status, outline: ch.outline })
        }
        const input = JSON.stringify({ mode: args.mode === 'format' ? 'format' : 'readiness', chapters })
        const r = await withTempFiles([{ name: 'outline.json', text: input }], ([p]) => bridge(config.python, ['outline', p!], { signal: exec.signal }))
        const titleOf = new Map(chapters.map(c => [c.id, `${c.position}.${c.title}`]))
        const issues = (r.issues as { chapter: string }[]).map(i => ({ ...i, chapter_title: titleOf.get(i.chapter) ?? '' }))
        return { work: w.key, title: w.title, pass: r.pass, checked: r.checked, errors: r.errors, issues, field_map: r.field_map, note: r.note }
      },
    }),

    defineWriterTool<{ work?: string; chapters?: string; include_previous?: boolean }>({
      name: 'fanqie_ledger_check',
      description: '跨章数字与时间对照：从所选章的章纲与正文里抽出带单位的数字（钱、数量、天数、时刻）和相对时间词（次日、第三天…），按来源列表。只抽取不判对错，用来"改完核旧账"。默认连带上一章。',
      properties: { work: WORK, chapters: S('章 id / 序号或区间，如 "5" 或 "3-5"（必填）'), include_previous: B('连带所选第一章的前一章，默认 true') },
      required: ['chapters'],
      async run(args, exec) {
        const w = await work(exec, args.work)
        let rows = pickChapters(w, args.chapters)
        if (args.include_previous !== false) {
          const first = rows[0]!
          const prev = [...w.chapters].reverse().find(c => c.position < first.position)
          if (prev && !rows.includes(prev)) rows = [prev, ...rows]
        }
        const files: { name: string; text: string }[] = []
        for (const r of rows) {
          const ch = await readChapter(w, r.id)
          const tag = `第${String(ch.position).padStart(3, '0')}章`
          const ot = outlineText(ch)
          if (ot.split('\n').length > 1) files.push({ name: `${tag}-章纲.md`, text: ot })
          if (ch.body.trim()) files.push({ name: `${tag}-正文-${ch.status}.md`, text: ch.body })
        }
        if (!files.length) throw new WriterError('NOT_FOUND', '所选章节既没有章纲也没有正文')
        const r = await withTempFiles(files, (paths) => bridge(config.python, ['ledger', ...paths], { signal: exec.signal }))
        return { work: w.key, files: r.files, items: r.items, note: r.note }
      },
    }),

    defineWriterTool<{ file?: string; top?: number; keywords?: string }>({
      name: 'fanqie_library_scan',
      description: '拆书测绘：读本地 TXT/MD 小说，识别卷章、统计字数与关键词次数、给出前 N 章开篇明细与章末片段。文件须在会话工作目录内。',
      properties: { file: S('小说文件路径（相对会话工作目录）'), top: I('前 N 章明细，默认 10'), keywords: S('逗号分隔的人物/道具/设定词') },
      required: ['file'],
      async run(args, exec) {
        const f = await localFile(exec, str(args.file))
        const top = Number.isInteger(args.top) && args.top! > 0 ? Math.min(args.top!, 100) : 10
        const r = await bridge(config.python, ['scan', f, String(top), str(args.keywords)], { signal: exec.signal })
        const { tool: _t, rules_version, ok: _o, ...rest } = r
        return { ...rest, rules_version }
      },
    }),

    defineWriterTool<{ source?: string; analysis?: string; analysis_text?: string; min_chars?: number }>({
      name: 'fanqie_quote_check',
      description: '引文核对：拆解稿里放进引号的文字必须是原文逐字引文。逐字命中=通过；部分命中=按原文改回；不命中=编造或是自己的概括（去掉引号）。',
      properties: {
        source: S('原文文件路径（相对会话工作目录）'),
        analysis: S('拆解稿文件路径（与 analysis_text 二选一）'),
        analysis_text: S('直接给拆解稿文字'),
        min_chars: I('引号内少于这么多汉字不核对，默认 6'),
      },
      required: ['source'],
      async run(args, exec) {
        const src = await localFile(exec, str(args.source))
        const mc = String(Number.isInteger(args.min_chars) && args.min_chars! > 0 ? args.min_chars : 6)
        const go = (ana: string) => bridge(config.python, ['quote', src, ana, mc], { signal: exec.signal })
        const r = args.analysis_text
          ? await withTempFiles([{ name: '拆解稿.md', text: str(args.analysis_text) }], ([p]) => go(p!))
          : await go(await localFile(exec, str(args.analysis)))
        return { pass: r.pass, checked: r.checked, not_verbatim: r.not_verbatim, items: r.items }
      },
    }),

    defineWriterTool<Record<string, unknown>>({
      name: 'fanqie_review_report',
      description: '提交编辑审读回报（固定格式，绑定当前正文版本）：结论 通过/未通过/结构性冲突；四类硬伤（关键剧情与落点、本书硬约束、人物认知、正文接续）逐条写位置、依据、最小修改方向；L1 结构与单元 / L2 场面与交锋 / L3 句面与声音 定位；可选建议单列。有硬伤不能判"通过"。正文一改，回报自动过期。',
      properties: {
        work: WORK,
        chapter: CHAPTER,
        verdict: E(VERDICTS, '结论'),
        hard_issues: {
          type: 'array', description: '四类硬伤；没有就给空数组',
          items: { type: 'object', properties: { category: E(HARD_CATEGORIES, '类别'), location: S('位置（段落/行号+短引）'), basis: S('违反的依据或阅读症状'), impact: S('影响'), fix: S('最小修改方向') }, required: ['category', 'location', 'basis', 'fix'] },
        },
        levels: {
          type: 'array', description: 'L1–L3 病灶定位；没有就给空数组',
          items: { type: 'object', properties: { level: E(LEVELS, '层级'), location: S('位置'), symptom: S('症状'), fix: S('修改方案') }, required: ['level', 'location', 'symptom', 'fix'] },
        },
        optional: { type: 'array', items: { type: 'string' }, description: '可选表达建议（不是硬伤），最多 3 条' },
        reread_full: B('是否完整回读了当前正文'),
        changed_scope: S('实际改动范围；只审不改写"未改"'),
        strengths: S('主要长处与保留理由（一两句）'),
      },
      required: ['chapter', 'verdict', 'hard_issues', 'levels', 'reread_full'],
      async run(args, exec) {
        const w = await work(exec, str(args.work))
        const ch = await readChapter(w, str(args.chapter))
        if (!ch.body.trim()) throw new WriterError('CONFLICT', `${ch.title} 还没有正文，无从审读`)
        const verdict = str(args.verdict) as ReviewReport['verdict']
        if (!VERDICTS.includes(verdict)) throw new WriterError('INVALID_ARGS', `verdict 只能是 ${VERDICTS.join(' / ')}`)
        const arr = (v: unknown) => (Array.isArray(v) ? v : []) as Record<string, unknown>[]
        const hard = arr(args.hard_issues).map(h => ({ category: str(h.category), location: str(h.location), basis: str(h.basis), impact: str(h.impact) || undefined, fix: str(h.fix) }))
        for (const h of hard) {
          if (!(HARD_CATEGORIES as readonly string[]).includes(h.category)) throw new WriterError('INVALID_ARGS', `硬伤类别只能是：${HARD_CATEGORIES.join('、')}`)
          if (!h.location || !h.basis || !h.fix) throw new WriterError('INVALID_ARGS', '每条硬伤都要写位置、依据、修改方向')
        }
        const levels = arr(args.levels).map(l => ({ level: str(l.level), location: str(l.location), symptom: str(l.symptom), fix: str(l.fix) }))
        for (const l of levels) if (!(LEVELS as readonly string[]).includes(l.level)) throw new WriterError('INVALID_ARGS', 'level 只能是 L1 / L2 / L3')
        if (verdict === '通过' && hard.length) throw new WriterError('INVALID_ARGS', '还有四类硬伤，不能判"通过"')
        if (verdict === '通过' && args.reread_full !== true) throw new WriterError('INVALID_ARGS', '没有完整回读当前正文，不能判"通过"')
        const optional = (Array.isArray(args.optional) ? args.optional : []).map(String).filter(Boolean).slice(0, 3)
        const report: ReviewReport = {
          work: w.key, work_title: w.title, chapter: ch.id, chapter_title: ch.title, body_sha256: ch.bodySha256,
          verdict, hard_issues: hard, levels, optional, reread_full: args.reread_full === true,
          changed_scope: str(args.changed_scope), strengths: str(args.strengths), by: deps.role, at: nowIso(),
        }
        const file = await saveReview(w.dir, report)
        return { saved: path.basename(file), verdict, body_sha256: ch.bodySha256, markdown: renderReview(report) }
      },
    }),

    defineWriterTool<{ work?: string; chapter?: string }>({
      name: 'fanqie_review_get',
      description: '取某章最新的编辑审读回报，并告诉你它是否仍对应当前正文（正文改过就过期）。',
      properties: { work: WORK, chapter: CHAPTER },
      required: ['chapter'],
      async run(args, exec) {
        const w = await work(exec, args.work)
        const ch = await readChapter(w, str(args.chapter))
        const r = await latestReview(w.dir, ch.id)
        if (!r) return { found: false, chapter: ch.id }
        const fresh = r.body_sha256 === ch.bodySha256
        return { found: true, fresh, verdict: r.verdict, by: r.by, at: r.at, markdown: renderReview(r, !fresh) }
      },
    }),

    createProfileTool('fanqie_profile', fanqieLibrary, { pinned: config.profile, methodTool: 'fanqie_forge_get' }),
  ]
  return deps.role === 'editor' ? tools.filter(t => EDITOR_TOOLS.has(t.name)) : tools
}
