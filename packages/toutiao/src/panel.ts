/**
 * 头条写作台（最简版，dev-plan T1.12）：本机浏览器打开 /writer/toutiao。
 * - 列表：按状态分组的文章、最近质检分、主标题；
 * - 详情：立项卡摘要、质检记录、交稿单全文；
 * - "采用"按钮：作者在此确认后，已验收且已出交稿单的文章改为“已交稿”。
 * 安全：只接受本机回环地址；POST 需要页面里下发的随机令牌（防跨站提交）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'
import { readText } from '../../core/src/fsx.js'
import { isLocalPanelRequest } from '../../core/src/http.js'
import { WriterError } from '../../dsh-adapter/src/index.js'
import { listKnownRoots, type ToutiaoConfig } from './env.js'
import { ArticleStore, nowIso, STATUSES, type ArticleMeta } from './store.js'
import { syncLedgerStatus, validPassingQa } from './tools.js'

export const PANEL_PATH = '/writer/toutiao'
export const ADOPT_PATH = '/writer/toutiao/api/adopt'

const TOKEN = randomBytes(24).toString('hex')

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

function send(res: ServerResponse, status: number, body: string, type = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN' })
  res.end(body)
}

async function allArticles(): Promise<{ root: string; meta: ArticleMeta }[]> {
  const out: { root: string; meta: ArticleMeta }[] = []
  for (const root of await listKnownRoots()) {
    for (const meta of await new ArticleStore(root).list()) out.push({ root, meta })
  }
  return out
}

const CSS = `body{font:15px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;margin:0;background:#f6f6f4;color:#222}
header{padding:14px 24px;background:#fff;border-bottom:1px solid #e5e5e0}h1{font-size:18px;margin:0}main{padding:16px 24px;max-width:1100px}
table{width:100%;border-collapse:collapse;background:#fff}td,th{padding:8px 10px;border-bottom:1px solid #eee;text-align:left;vertical-align:top}
th{font-weight:600;color:#666;font-size:13px}.tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;background:#eee}
.s-已验收{background:#e3f4e8;color:#1d6b35}.s-已交稿{background:#dfe9fb;color:#1e4fa3}.s-验收退回{background:#fde7e4;color:#a33}.s-待验收{background:#fff4d6;color:#8a6100}
pre{white-space:pre-wrap;background:#fff;border:1px solid #e5e5e0;padding:14px;border-radius:6px}button{font-size:15px;padding:8px 18px;border-radius:6px;border:0;background:#1e4fa3;color:#fff;cursor:pointer}
a{color:#1e4fa3;text-decoration:none}.muted{color:#888;font-size:13px}`

function page(title: string, body: string) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><header><h1>头条写作台</h1></header><main>${body}</main></body></html>`
}

async function renderList(): Promise<string> {
  const rows = await allArticles()
  if (rows.length === 0) return page('头条写作台', '<p>还没有文章。在会话里说“写一篇头条”开始。</p>')
  const order = new Map(STATUSES.map((s, i) => [s, i]))
  rows.sort((a, b) => (order.get(a.meta.status)! - order.get(b.meta.status)!) || b.meta.updated_at.localeCompare(a.meta.updated_at))
  const tr = rows.map(({ root, meta: m }) => {
    const q = m.qa[m.qa.length - 1]
    const href = `${PANEL_PATH}?root=${encodeURIComponent(root)}&id=${encodeURIComponent(m.id)}`
    return `<tr><td><span class="tag s-${esc(m.status)}">${esc(m.status)}</span></td><td><a href="${esc(href)}">${esc(m.headlines.main || m.title_hint || m.id)}</a><div class="muted">${esc(m.id)} · ${esc(m.line)} ${esc(m.genre)}</div></td><td>${q ? `${esc(q.score)} ${q.pass ? '过线' : '未过'}（rev ${esc(q.rev)}）` : '—'}</td><td class="muted">${esc(m.updated_at.replace('T', ' ').slice(0, 16))}</td></tr>`
  }).join('')
  return page('头条写作台', `<table><tr><th>状态</th><th>文章</th><th>最近质检</th><th>更新</th></tr>${tr}</table>`)
}

async function renderDetail(root: string, id: string): Promise<string> {
  const store = new ArticleStore(root)
  const m = await store.get(id)
  const card = (await store.readCard(id)) ?? {}
  const delivery = m.delivered ? await readText(store.deliveryPath(id)) : undefined
  const q = m.qa[m.qa.length - 1]
  const canAdopt = m.status === '已验收' && m.delivered
  const adopt = canAdopt
    ? `<form method="post" action="${ADOPT_PATH}" onsubmit="return confirm('确认采用这篇并标记为“已交稿”？AI 不会替你发布。')"><input type="hidden" name="root" value="${esc(root)}"><input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="token" value="${TOKEN}"><button>采用（标记为已交稿）</button></form>`
    : `<p class="muted">${m.status === '已交稿' ? '已交稿。' : '验收通过并生成交稿单后可以在这里采用。'}</p>`
  const facts = [
    ['状态', m.status], ['内容线 / 体裁', `${m.line} ${m.genre}`], ['主问题', card['主问题']], ['主推标题', m.headlines.main],
    ['备选标题', m.headlines.alts.join(' / ')], ['当前版本', `rev ${m.current_rev}`], ['打回轮数', m.return_rounds],
    ['最近质检', q ? `${q.score} 分 ${q.pass ? '过线' : '未过线'}${q.hard_gates.length ? '，硬闸：' + q.hard_gates.join('、') : ''}（规则 ${q.rules_version}）` : '—'],
  ].map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v ?? '')}</td></tr>`).join('')
  return page(m.headlines.main || id, `<p><a href="${PANEL_PATH}">← 全部文章</a></p><table>${facts}</table><h3>操作</h3>${adopt}<h3>交稿单</h3>${delivery ? `<pre>${esc(delivery)}</pre>` : '<p class="muted">尚未生成。</p>'}`)
}

function readBody(req: IncomingMessage, limit = 16 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { reject(new Error('body too large')); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** 作者在写作台采用：校验后改为已交稿。导出供测试。 */
export async function adopt(root: string, id: string, config: ToutiaoConfig = {}): Promise<ArticleMeta> {
  if (!(await listKnownRoots()).includes(path.resolve(root))) throw new WriterError('NOT_FOUND', '未知的存储目录')
  const store = new ArticleStore(path.resolve(root))
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

export function createPanelHandlers(config: ToutiaoConfig) {
  const view = async (req: IncomingMessage, res: ServerResponse) => {
    if (!isLocalPanelRequest(req)) return send(res, 403, 'forbidden', 'text/plain')
    if (req.method !== 'GET') return send(res, 405, 'method not allowed', 'text/plain')
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const root = url.searchParams.get('root')
      const id = url.searchParams.get('id')
      if (root && id) {
        if (!(await listKnownRoots()).includes(root)) return send(res, 404, page('未找到', '<p>未知的存储目录。</p>'))
        return send(res, 200, await renderDetail(root, id))
      }
      return send(res, 200, await renderList())
    } catch (err: any) {
      return send(res, 500, page('出错', `<p>${esc(err?.message ?? err)}</p>`))
    }
  }
  const adoptHandler = async (req: IncomingMessage, res: ServerResponse) => {
    if (!isLocalPanelRequest(req)) return send(res, 403, 'forbidden', 'text/plain')
    if (req.method !== 'POST') return send(res, 405, 'method not allowed', 'text/plain')
    try {
      const form = new URLSearchParams(await readBody(req))
      const token = form.get('token') ?? ''
      const a = Buffer.from(token), b = Buffer.from(TOKEN)
      if (a.length !== b.length || !timingSafeEqual(a, b)) return send(res, 403, 'bad token', 'text/plain')
      const root = form.get('root') ?? '', id = form.get('id') ?? ''
      await adopt(root, id, config)
      res.writeHead(303, { location: `${PANEL_PATH}?root=${encodeURIComponent(root)}&id=${encodeURIComponent(id)}`, 'cache-control': 'no-store' })
      res.end()
    } catch (err: any) {
      return send(res, 400, page('未能采用', `<p>${esc(err?.message ?? err)}</p><p><a href="${PANEL_PATH}">返回</a></p>`))
    }
  }
  return [
    { path: PANEL_PATH, handler: (req: IncomingMessage, res: ServerResponse) => { void view(req, res) } },
    { path: ADOPT_PATH, handler: (req: IncomingMessage, res: ServerResponse) => { void adoptHandler(req, res) } },
  ]
}

export const __panelTesting = { TOKEN, renderList, renderDetail }
