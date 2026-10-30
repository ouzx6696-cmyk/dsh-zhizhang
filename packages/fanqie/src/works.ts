/**
 * 写作层读作品：直接用引擎的存储层与作品选择逻辑（work 参数 → 本会话上次打开的作品 → 只有一部时用它）。
 * 这里只读；落盘一律走引擎工具。
 */
import { WriterError, type HostToolExecution } from '../../host/src/index.js'
import { bodyFingerprint } from './review.js'
import { readChapter as engineReadChapter, readWorkMeta } from './engine/store.js'
import { openWork as engineOpenWork } from './engine/tools/context.js'
import { NovelError } from './engine/errors.js'

export interface ChapterOutline {
  pov?: string; targetWords?: number; locks?: string; knowledge?: string
  synopsis?: string; conflict?: string; beats?: string; ending?: string
  [k: string]: unknown
}

export interface ChapterRow { id: string; title: string; position: number; status: string; wordCount?: number }

export interface ChapterRecord extends ChapterRow {
  outline: ChapterOutline
  body: string
  bodySha256: string
}

export interface WorkInfo { key: string; title: string; dir: string; chapters: ChapterRow[] }

export { bodyFingerprint }

function rethrow(err: unknown): never {
  if (err instanceof NovelError) {
    const code = /not_found|不存在|没有/.test(`${err.code} ${err.message}`) ? 'NOT_FOUND' : 'INVALID_ARGS'
    throw new WriterError(code, err.message)
  }
  throw err
}

function sortRows(rows: unknown): ChapterRow[] {
  return (Array.isArray(rows) ? rows : [])
    .filter((r): r is ChapterRow => !!r && typeof r === 'object' && typeof (r as ChapterRow).id === 'string')
    .map(r => ({ id: r.id, title: String(r.title ?? r.id), position: Number(r.position ?? 0), status: String(r.status ?? ''), wordCount: r.wordCount }))
    .sort((a, b) => a.position - b.position)
}

export async function workAt(dir: string): Promise<WorkInfo> {
  const meta = await readWorkMeta(dir)
  return { key: String(meta.key), title: String(meta.title ?? meta.key), dir, chapters: sortRows(meta.chapters) }
}

/** 按长篇工具同样的规则选作品 */
export async function openWork(exec: HostToolExecution | undefined, work?: string, workingDir?: string): Promise<WorkInfo> {
  try {
    const { dir } = await engineOpenWork(exec as never, { work: work || undefined, working_dir: workingDir || undefined })
    return await workAt(dir)
  } catch (err) { rethrow(err) }
}

function findRow(work: WorkInfo, id: string): ChapterRow | undefined {
  return work.chapters.find(c => c.id === id || c.title === id || String(c.position) === id)
}

export async function readChapter(work: WorkInfo, id: string): Promise<ChapterRecord> {
  const row = findRow(work, id)
  if (!row) throw new WriterError('NOT_FOUND', `《${work.title}》没有这一章：${id}。现有：${work.chapters.map(c => `${c.position}.${c.title}（${c.id}）`).join('、') || '无'}`)
  let rec: { body?: string; outline?: ChapterOutline; status?: string; title?: string; wordCount?: number }
  try {
    rec = await engineReadChapter(work.dir, row.id) as typeof rec
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') rec = {}
    else rethrow(err)
  }
  const body = typeof rec.body === 'string' ? rec.body : ''
  return { ...row, title: String(rec.title ?? row.title), status: String(rec.status ?? row.status), outline: rec.outline ?? {}, body, bodySha256: bodyFingerprint(body) }
}

/** 解析章节选择：单章 id/序号，或 "3-5" 区间，或省略 = 全部 */
export function pickChapters(work: WorkInfo, spec?: string): ChapterRow[] {
  if (!spec?.trim()) return work.chapters
  const s = spec.trim()
  const range = s.match(/^(\d+)\s*[-–~]\s*(\d+)$/)
  if (range) {
    const a = Number(range[1]), b = Number(range[2])
    const rows = work.chapters.filter(c => c.position >= Math.min(a, b) && c.position <= Math.max(a, b))
    if (!rows.length) throw new WriterError('NOT_FOUND', `第 ${a}–${b} 章不存在`)
    return rows
  }
  const ids = s.split(/[,，\s]+/).filter(Boolean)
  return ids.map(id => {
    const row = findRow(work, id)
    if (!row) throw new WriterError('NOT_FOUND', `没有这一章：${id}`)
    return row
  })
}
