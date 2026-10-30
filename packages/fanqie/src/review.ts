/**
 * 编辑审读回报：固定格式、绑定正文版本、跟着书存（<作品目录>/writer-reviews/<章 id>/<时间>.json）。
 * 定稿条件（requireEditorPass）与写作台单章附带的审读信息也在这里，工具定稿与写作台定稿共用。
 */
import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { atomicWrite, readJson, resolveInside, sha256 } from '../../core/src/fsx.js'
import { readWorkMeta } from './engine/store.js'

/** 审读绑定的正文指纹：首尾各去一个换行，避免保存时的换行差异让回报误判过期 */
export function bodyFingerprint(body: string): string {
  return sha256(body.replace(/^\r?\n/, '').replace(/\r?\n$/, ''))
}


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

function slug(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || '_'
}

/** 审读回报跟着书走，数据备份会一并带上 */
export function reviewDir(workDir: string, chapter: string): string {
  return resolveInside(workDir, 'writer-reviews', slug(chapter))
}

export async function saveReview(workDir: string, r: ReviewReport): Promise<string> {
  const dir = reviewDir(workDir, r.chapter)
  const file = path.join(dir, `${r.at.replace(/[:.+]/g, '-')}.json`)
  await atomicWrite(file, JSON.stringify(r, null, 2))
  return file
}

export async function latestReview(workDir: string, chapter: string): Promise<ReviewReport | undefined> {
  const dir = reviewDir(workDir, chapter)
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

/** 定稿前的审读条件：返回问题描述，undefined 表示满足。bodySha 为当前（或将要写入的）正文指纹 */
export async function editorPassProblem(workDir: string, chapter: { id: string; title: string }, bodySha: string): Promise<string | undefined> {
  const r = await latestReview(workDir, chapter.id)
  if (!r) return `${chapter.title} 还没有编辑审读回报；先派编辑子代理审读（fanqie_review_report）`
  if (r.body_sha256 !== bodySha) return `${chapter.title} 的审读回报对应的是旧正文，正文改过后要重新审读`
  if (r.verdict !== '通过') return `${chapter.title} 最新审读结论是「${r.verdict}」，硬伤解决并重审通过后才能定稿`
  return undefined
}

async function chapterTitle(dir: string, chapterId: string): Promise<string> {
  const meta = await readWorkMeta(dir).catch(() => undefined) as { chapters?: { id: string; title?: string }[] } | undefined
  return meta?.chapters?.find(c => c.id === chapterId)?.title ?? chapterId
}

/** 定稿前的写作层条件（requireEditorPass）；工具定稿与写作台定稿都经过这里。返回拒绝理由，undefined 表示放行 */
export async function finalizeProblem(dir: string, chapterId: string, body: string, requireEditorPass: boolean): Promise<string | undefined> {
  if (!requireEditorPass) return undefined
  return editorPassProblem(dir, { id: chapterId, title: await chapterTitle(dir, chapterId) }, bodyFingerprint(body))
}

/** 写作台读单章时附带：最新审读回报摘要与定稿条件 */
export async function chapterReviewInfo(dir: string, chapterId: string, body: string, requireEditorPass: boolean) {
  const r = await latestReview(dir, chapterId)
  const sha = bodyFingerprint(body)
  const finalizeBlocked = requireEditorPass ? await editorPassProblem(dir, { id: chapterId, title: await chapterTitle(dir, chapterId) }, sha) : undefined
  return {
    editorReview: r ? {
      verdict: r.verdict, stale: r.body_sha256 !== sha, at: r.at, by: r.by,
      hardIssues: r.hard_issues.length, levels: r.levels.length, rereadFull: r.reread_full,
      summary: r.hard_issues.slice(0, 2).map(h => `【${h.category}】${h.location}：${h.basis}`).join('；') || r.strengths || undefined,
    } : null,
    requireEditorPass,
    ...(finalizeBlocked ? { finalizeBlocked } : {}),
  }
}
