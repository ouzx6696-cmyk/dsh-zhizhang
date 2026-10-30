/**
 * 写作工作台 · 今日头条模式的数据与动作（与 HTTP 无关；路由由 packages/app 挂到写作台接口上）。
 *   - listArticles   全部已知数据目录里的文章（按状态排序）
 *   - articleDetail  单篇：立项卡要点、标题、当前稿、质检、交稿单、状态历史
 *   - adopt          作者在写作台“采用”：已验收 + 已出交稿单 + 质检仍有效 → 已交稿
 *   - buildToutiaoDelivery  写作台按钮 → 投递到对话的一条消息
 */
import path from 'node:path'
import { readText } from '../../../core/src/fsx.js'
import { WriterError } from '../../../host/src/index.js'
import { listKnownRoots, type ToutiaoConfig } from '../env.js'
import { ArticleStore, MAX_RETURN_ROUNDS, nowIso, STATUSES, type ArticleMeta } from '../store.js'
import { syncLedgerStatus, validPassingQa } from '../tools.js'

export const TOUTIAO_ACTIONS = ['new', 'continue', 'review', 'revise'] as const
export type ToutiaoAction = (typeof TOUTIAO_ACTIONS)[number]
export const ENABLE_HINT_TOUTIAO = '（本会话若还没启用：先 writer_enable mode=toutiao。）'

const BODY_CAP = 200_000

function titleOf(m: ArticleMeta) {
  return m.headlines.main || m.title_hint || m.id
}

async function knownRoot(root: string): Promise<string> {
  const r = path.resolve(root)
  if (!(await listKnownRoots()).includes(r)) throw new WriterError('NOT_FOUND', '未知的头条数据目录')
  return r
}

export async function listArticles() {
  const roots = await listKnownRoots()
  const rows: Record<string, unknown>[] = []
  for (const root of roots) {
    let metas: ArticleMeta[] = []
    try { metas = await new ArticleStore(root).list() } catch { continue }
    for (const m of metas) {
      const q = m.qa.at(-1)
      rows.push({
        root, id: m.id, title: titleOf(m), status: m.status, line: m.line, genre: m.genre, rev: m.current_rev,
        qa: q ? { score: q.score, pass: q.pass, rev: q.rev, current: q.rev === m.current_rev } : null,
        delivered: m.delivered, returnRounds: m.return_rounds, updatedAt: m.updated_at,
      })
    }
  }
  const order = new Map(STATUSES.map((s, i) => [s as string, i]))
  rows.sort((a, b) => (order.get(String(a.status))! - order.get(String(b.status))!) || String(b.updatedAt).localeCompare(String(a.updatedAt)))
  return { roots, statuses: [...STATUSES], articles: rows }
}

export async function articleDetail(rootIn: string, id: string) {
  const root = await knownRoot(rootIn)
  const store = new ArticleStore(root)
  const m = await store.get(id)
  const card = (await store.readCard(id)) ?? {}
  const cur = store.currentDraft(m)
  let draft = cur ? await store.readDraft(id, cur.rev).catch(() => '') : ''
  const truncated = draft.length > BODY_CAP
  if (truncated) draft = draft.slice(0, BODY_CAP) + '\n\n…（已截断）'
  const delivery = m.delivered ? await readText(store.deliveryPath(id)).catch(() => undefined) : undefined
  const qaValid = m.current_rev > 0 ? await validPassingQa(store, m) : { ok: false as const, reason: '还没有稿件' }
  const pick = (k: string) => (typeof card[k] === 'string' ? card[k] as string : undefined)
  return {
    root, id: m.id, title: titleOf(m), status: m.status, line: m.line, genre: m.genre,
    headlines: m.headlines, rev: m.current_rev, returnRounds: m.return_rounds, maxReturnRounds: MAX_RETURN_ROUNDS,
    card: { 主问题: pick('主问题'), 核心事实: pick('核心事实'), 读者: pick('读者') ?? pick('目标读者'), 出处: card['出处'] ?? undefined, present: Object.keys(card).length > 0 },
    draft: cur ? { rev: cur.rev, role: cur.role, chars: cur.chars, at: cur.created_at, note: cur.note, text: draft, truncated } : null,
    drafts: m.drafts.map(d => ({ rev: d.rev, role: d.role, chars: d.chars, at: d.created_at, note: d.note })),
    qa: m.qa.map(q => ({ rev: q.rev, score: q.score, pass: q.pass, hardGates: q.hard_gates, failCount: q.fail_count, rulesVersion: q.rules_version, at: q.at })),
    qaValid: qaValid.ok, qaProblem: qaValid.ok ? undefined : qaValid.reason,
    delivery: delivery ?? null,
    history: m.history.map(h => ({ from: h.from, to: h.to, by: h.by, at: h.at, note: h.note })),
    adoptable: m.status === '已验收' && m.delivered && qaValid.ok,
    updatedAt: m.updated_at,
  }
}

/** 作者在写作台采用：校验后改为已交稿。 */
export async function adopt(rootIn: string, id: string, config: ToutiaoConfig = {}): Promise<ArticleMeta> {
  const root = await knownRoot(rootIn)
  const store = new ArticleStore(root)
  const m0 = await store.get(id)
  if (m0.status !== '已验收' || !m0.delivered) throw new WriterError('CONFLICT', '只有已验收且已生成交稿单的文章可以采用')
  const v = await validPassingQa(store, m0)
  if (!v.ok) throw new WriterError('GATE_DENIED', v.reason)
  const m = await store.update(id, (mm) => {
    if (mm.status !== '已验收') throw new WriterError('CONFLICT', '状态已变化')
    mm.history.push({ from: mm.status, to: '已交稿', by: 'author-panel', at: nowIso(), note: '作者在写作台采用' })
    mm.status = '已交稿'
  })
  await syncLedgerStatus(config, store, m).catch(() => undefined)
  return m
}

/** 写作台按钮 → 对话消息。正文仍由 Agent 在会话里写；作者附言 ≤300 字原样附在末尾。 */
export async function buildToutiaoDelivery(rootIn: string, input: { action: string; id?: string; note?: string }) {
  if (!(TOUTIAO_ACTIONS as readonly string[]).includes(input.action)) throw new WriterError('INVALID_ARGS', `不支持的动作：${input.action}`)
  const action = input.action as ToutiaoAction
  const root = await knownRoot(rootIn)
  const note = (input.note ?? '').trim().slice(0, 300)
  const lines: string[] = []
  if (action === 'new') {
    lines.push(note
      ? `【写作台】写一篇新的今日头条，题材/素材：${note}`
      : '【写作台】写一篇新的今日头条：先 toutiao_feedback_read 与台账，按 S1 找题，给我 3 个候选题再立项。')
    lines.push('按总则从 S1/S2 走到 S6 质检过线并送验收；不要标记已交稿。')
  } else {
    if (!input.id) throw new WriterError('INVALID_ARGS', '须指明文章')
    const store = new ArticleStore(root)
    const m = await store.get(input.id)
    const ref = `《${titleOf(m)}》（${m.id}，rev ${m.current_rev}，${m.status}）`
    const q = m.qa.at(-1)
    if (action === 'continue') {
      const next: Record<string, string> = {
        初稿待改: '把这一版推进到质检过线并送验收（需要的话派编辑子代理红笔）',
        待验收: '按质检与验收结论决定：过线就改为已验收并出交稿单，否则验收退回',
        验收退回: '按退回意见改稿、重跑质检，过线再送验收',
        已验收: '出交稿单（toutiao_delivery_save）、记台账，然后告诉我可以在写作台采用',
        已交稿: '这篇已交稿；只在我明确要求时再改',
      }
      lines.push(`【写作台】继续${ref}：${next[m.status] ?? '按总则推进到下一步'}。`)
      lines.push('不要标记已交稿，那一步由我确认。')
    } else if (action === 'review') {
      lines.push(`【写作台】派编辑子代理给${ref}红笔并质检：提示词写“【头条编辑任务】先调用 writer_enable，参数 mode=toutiao、role=editor；文章 id=${m.id}；按 s5-editing 红笔、记三联表、存编辑版、跑质检，回报分数与三联表”。收到回报后把分数和要点告诉我。`)
    } else {
      const why = q ? `最近质检 ${q.score} 分${q.pass ? '过线' : '未过线'}${q.hard_gates.length ? `，硬闸：${q.hard_gates.join('、')}` : ''}（rev ${q.rev}）` : '还没有质检记录'
      lines.push(`【写作台】按最近的质检与编辑意见修改${ref}。${why}。只改 fails、硬闸与三联表指出的位置，存新版本后重跑 toutiao_qa_check；不靠换词、堆口语词或数字凑分。`)
    }
  }
  lines.push(ENABLE_HINT_TOUTIAO)
  if (note && action !== 'new') lines.push(`作者附言：${note}`)
  return { action, id: input.id, text: lines.join('\n') }
}
