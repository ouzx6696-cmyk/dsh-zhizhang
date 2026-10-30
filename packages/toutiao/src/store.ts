/**
 * 头条文章存储。目录布局：
 *
 *   <root>/                       默认 <会话 cwd>/outputs/toutiao
 *     log.csv                     发稿台账（由 Python ledger 读写，格式不变）
 *     feedback.md                 作者改稿反馈
 *     <id>/                       一篇文章，id = YYYY-MM-DD-slug
 *       meta.json                 插件独占写入
 *       立项卡.json
 *       drafts/rev-001.md …       每一版稿件，只增不改
 *       edits.json                S5 三联改写留痕
 *       交稿单.md
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { WriterError } from '../../host/src/index.js'
import { atomicWrite, exists, readJson, readText, resolveInside, serialize, sha256 } from '../../core/src/fsx.js'

export const STATUSES = ['初稿待改', '待验收', '已验收', '验收退回', '已交稿'] as const
export type Status = typeof STATUSES[number]
export const LINES = ['资讯线', '故事线'] as const
export const GENRES = ['长图文', '短图文', '微头条'] as const
export type Genre = typeof GENRES[number]

export const MAX_RETURN_ROUNDS = 2
export const STOP_LINE = '——AI 到此止步。是否采用、何时发布由你决定。'

export interface DraftRecord { rev: number; role: string; sha256: string; chars: number; created_at: string; note: string }
export interface QaRecord {
  rev: number; sha256: string; pass: boolean; score: number; hard_gates: string[]
  fail_count: number; rules_version: string; card_sha256: string | null; at: string
}
export interface HistoryRecord { from: Status | null; to: Status; by: string; at: string; note?: string }

export interface ArticleMeta {
  schema: 1
  id: string
  title_hint: string
  line: string
  genre: string
  status: Status
  current_rev: number
  drafts: DraftRecord[]
  qa: QaRecord[]
  return_rounds: number
  headlines: { main: string; alts: string[] }
  delivered: boolean
  history: HistoryRecord[]
  created_at: string
  updated_at: string
}

/** 允许的状态跳转（不含门禁；门禁另查） */
const TRANSITIONS: Record<Status, Status[]> = {
  初稿待改: ['待验收'],
  待验收: ['已验收', '验收退回', '初稿待改'],
  验收退回: ['初稿待改', '待验收'],
  已验收: ['已交稿', '验收退回'],
  已交稿: [],
}

export function canTransition(from: Status, to: Status): boolean {
  return TRANSITIONS[from].includes(to)
}

export { nowIso } from '../../core/src/fsx.js'
import { nowIso } from '../../core/src/fsx.js'

export function today(): string {
  return nowIso().slice(0, 10)
}

const SLUG_RE = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,40}$/u
const ID_RE = /^\d{4}-\d{2}-\d{2}-[\p{L}\p{N}][\p{L}\p{N}_-]{0,40}$/u

export class ArticleStore {
  constructor(readonly root: string) {}

  get ledgerPath(): string { return path.join(this.root, 'log.csv') }
  get feedbackPath(): string { return path.join(this.root, 'feedback.md') }

  dir(id: string): string {
    if (!ID_RE.test(id)) throw new WriterError('INVALID_ARGS', `文章 id 不合法：${id}（应为 YYYY-MM-DD-简短英文或拼音或中文）`)
    return resolveInside(this.root, id)
  }
  metaPath(id: string) { return path.join(this.dir(id), 'meta.json') }
  cardPath(id: string) { return path.join(this.dir(id), '立项卡.json') }
  draftPath(id: string, rev: number) { return path.join(this.dir(id), 'drafts', `rev-${String(rev).padStart(3, '0')}.md`) }
  editsPath(id: string) { return path.join(this.dir(id), 'edits.json') }
  deliveryPath(id: string) { return path.join(this.dir(id), '交稿单.md') }

  async create(slug: string, opts: { date?: string; titleHint?: string; line?: string; genre?: string }): Promise<ArticleMeta> {
    const s = slug.trim()
    if (!SLUG_RE.test(s)) throw new WriterError('INVALID_ARGS', 'slug 只能用字母、数字、中文、-、_，最长 41 字')
    const date = opts.date ?? today()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new WriterError('INVALID_ARGS', 'date 格式应为 YYYY-MM-DD')
    const id = `${date}-${s}`
    return serialize(this.metaPath(id), async () => {
      if (await exists(this.metaPath(id))) throw new WriterError('CONFLICT', `文章已存在：${id}`)
      const at = nowIso()
      const meta: ArticleMeta = {
        schema: 1, id, title_hint: opts.titleHint ?? '', line: opts.line ?? '', genre: opts.genre ?? '',
        status: '初稿待改', current_rev: 0, drafts: [], qa: [], return_rounds: 0,
        headlines: { main: '', alts: [] }, delivered: false,
        history: [{ from: null, to: '初稿待改', by: 'agent', at, note: '立项' }],
        created_at: at, updated_at: at,
      }
      await atomicWrite(this.metaPath(id), JSON.stringify(meta, null, 2))
      return meta
    })
  }

  async get(id: string): Promise<ArticleMeta> {
    const meta = await readJson<ArticleMeta>(this.metaPath(id))
    if (!meta) throw new WriterError('NOT_FOUND', `没有这篇文章：${id}`)
    return meta
  }

  /** 读改写 meta.json，同一文章串行 */
  async update(id: string, fn: (m: ArticleMeta) => Promise<void> | void): Promise<ArticleMeta> {
    return serialize(this.metaPath(id), async () => {
      const meta = await this.get(id)
      await fn(meta)
      meta.updated_at = nowIso()
      await atomicWrite(this.metaPath(id), JSON.stringify(meta, null, 2))
      return meta
    })
  }

  async list(): Promise<ArticleMeta[]> {
    let names: string[] = []
    try { names = await readdir(this.root) } catch { return [] }
    const out: ArticleMeta[] = []
    for (const n of names) {
      if (!ID_RE.test(n)) continue
      const m = await readJson<ArticleMeta>(path.join(this.root, n, 'meta.json')).catch(() => undefined)
      if (m) out.push(m)
    }
    out.sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return out
  }

  async readCard(id: string): Promise<Record<string, unknown> | undefined> {
    return readJson<Record<string, unknown>>(this.cardPath(id))
  }

  async writeCard(id: string, card: Record<string, unknown>): Promise<string> {
    await this.get(id)
    const text = JSON.stringify(card, null, 2)
    await atomicWrite(this.cardPath(id), text)
    return sha256(text)
  }

  async cardSha(id: string): Promise<string | null> {
    const t = await readText(this.cardPath(id))
    return t === undefined ? null : sha256(t)
  }

  async readDraft(id: string, rev: number): Promise<string> {
    const t = await readText(this.draftPath(id, rev))
    if (t === undefined) throw new WriterError('NOT_FOUND', `没有第 ${rev} 版稿件`)
    return t
  }

  /** 新增一版稿件（只增不改）。已交稿的文章不再接受新稿。 */
  async stageDraft(id: string, text: string, role: string, note: string): Promise<ArticleMeta> {
    return this.update(id, async (m) => {
      if (m.status === '已交稿') throw new WriterError('CONFLICT', '这篇已交稿，不能再改；需要改写请新开一篇')
      const rev = m.current_rev + 1
      const file = this.draftPath(id, rev)
      if (await exists(file)) throw new WriterError('CONFLICT', `第 ${rev} 版已存在，meta 与稿件目录不一致`)
      await atomicWrite(file, text)
      m.drafts.push({ rev, role, sha256: sha256(text), chars: [...text].length, created_at: nowIso(), note })
      m.current_rev = rev
      if (m.status !== '初稿待改') {
        m.history.push({ from: m.status, to: '初稿待改', by: 'agent', at: nowIso(), note: `新稿 rev ${rev}` })
        m.status = '初稿待改'
      }
    })
  }

  currentDraft(m: ArticleMeta): DraftRecord | undefined {
    return m.drafts.find(d => d.rev === m.current_rev)
  }

  /** 当前版本最近一次质检是否过线，且稿件与立项卡都没改过 */
  latestQaFor(m: ArticleMeta): QaRecord | undefined {
    const cur = this.currentDraft(m)
    if (!cur) return undefined
    const hits = m.qa.filter(q => q.rev === cur.rev && q.sha256 === cur.sha256)
    return hits[hits.length - 1]
  }
}
