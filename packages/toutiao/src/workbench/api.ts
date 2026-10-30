/**
 * 写作台 · 今日头条模式的接口：
 *   GET  /api/writer/toutiao/articles               全部文章 + 每个数据目录能否投递
 *   GET  /api/writer/toutiao/article?root=&id=      单篇详情
 *   POST /api/writer/toutiao/adopt   {root,id,confirm}                          作者采用 → 已交稿
 *   POST /api/writer/toutiao/deliver {root,id?,action,note?,requestId?,confirm}  按钮指令发到对话
 */
import { WriterError } from '../../../host/src/index.js'
import { deliver, deliveryProblem, promptSink, sessionFor } from '../../../core/src/sessions.js'
import { API, type RouteContext, type WorkbenchMode } from '../../../workbench/src/server.js'
import type { ToutiaoConfig } from '../env.js'
import { adopt, articleDetail, buildToutiaoDelivery, listArticles, TOUTIAO_ACTIONS } from './data.js'

const BASE = `${API}/toutiao`
const ROUTES = { articles: `${BASE}/articles`, article: `${BASE}/article`, adopt: `${BASE}/adopt`, deliver: `${BASE}/deliver` }

function fail(ctx: RouteContext, err: unknown) {
  if (err instanceof WriterError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'INVALID_ARGS' ? 400 : 409
    return ctx.json(status, { ok: false, code: err.code, error: err.message })
  }
  ctx.json(500, { ok: false, code: 'failed', error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) })
}

const str = (x: unknown) => (typeof x === 'string' ? x : '')

export function toutiaoApi(config: ToutiaoConfig): WorkbenchMode {
  return {
    routes: Object.values(ROUTES),
    async handle(ctx) {
      const route = Object.entries(ROUTES).find(([, p]) => p === ctx.path)?.[0]
      if (!route) return false
      const want = route === 'adopt' || route === 'deliver' ? 'POST' : 'GET'
      if (ctx.method !== want) { ctx.json(405, { ok: false, code: 'method', error: `${want} required` }); return true }
      try {
        if (route === 'articles') {
          const data = await listArticles()
          const sessions: Record<string, string> = {}
          for (const root of data.roots) {
            const s = await sessionFor(root)
            if (s) sessions[root] = s.at
          }
          const sink = !!promptSink()
          ctx.json(200, { ok: true, ...data, actions: [...TOUTIAO_ACTIONS], sessions, deliver: sink, deliverReason: sink ? undefined : '当前宿主没有会话控制服务（headless 或不支持的 DSH 版本），无法发到对话' })
        } else if (route === 'article') {
          const root = ctx.url.searchParams.get('root') ?? '', id = ctx.url.searchParams.get('id') ?? ''
          if (!root || !id) ctx.json(400, { ok: false, code: 'bad_request', error: '须指明 root 与 id' })
          else ctx.json(200, { ok: true, article: await articleDetail(root, id) })
        } else if (route === 'adopt') {
          const body = await ctx.body(16_000)
          if (!body) return true
          if (body.confirm !== true || !str(body.root) || !str(body.id)) ctx.json(400, { ok: false, code: 'confirmation_required', error: '须明确确认、数据目录与文章。' })
          else {
            const m = await adopt(str(body.root), str(body.id), config)
            ctx.json(200, { ok: true, id: m.id, status: m.status })
          }
        } else {
          const body = await ctx.body(16_000)
          if (!body) return true
          if (body.confirm !== true || !str(body.root) || !str(body.action)) {
            ctx.json(400, { ok: false, code: 'confirmation_required', error: '须明确确认、数据目录与动作。' })
            return true
          }
          const problem = await deliveryProblem(str(body.root))
          if (problem) { ctx.json(problem.code === 'no_session' ? 409 : 503, { ok: false, code: problem.code, error: problem.message }); return true }
          const p = await buildToutiaoDelivery(str(body.root), { action: str(body.action), id: str(body.id) || undefined, note: str(body.note) || undefined })
          try {
            const sent = await deliver(str(body.root), p.text, str(body.requestId) || undefined)
            ctx.json(200, { ok: true, action: p.action, id: p.id, requestId: sent.requestId, text: p.text })
          } catch (err) {
            ctx.json(502, { ok: false, code: String((err as { code?: string })?.code ?? 'deliver_failed'), error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) })
          }
        }
      } catch (err) { fail(ctx, err) }
      return true
    },
  }
}
