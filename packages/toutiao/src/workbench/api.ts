/**
 * 写作台 · 今日头条模式的接口：
 *   GET  /api/writer/toutiao/articles               全部文章 + 每个数据目录能否投递
 *   GET  /api/writer/toutiao/article?root=&id=      单篇详情
 *   POST /api/writer/toutiao/adopt   {root,id,expectedRev,expectedSha256,confirm} 作者采用 → 已交稿
 *   POST /api/writer/toutiao/deliver {root,id?,action,note?,requestId?,confirm}  按钮指令发到对话
 *   POST /api/writer/toutiao/draft  {root,id,text}                    作者直接保存一版
 */
import { API, ROUTES, sendError, type WorkbenchMode } from '../../../workbench/src/routes.js'
import type { ToutiaoConfig } from '../env.js'
import { adopt, articleDetail, listArticles, saveAuthorDraft, TOUTIAO_ACTIONS } from './data.js'

const paths = { articles: API + ROUTES.articles, article: API + ROUTES.article,
  adopt: API + ROUTES.adoptArticle, draft: API + ROUTES.saveArticle }

const str = (x: unknown) => (typeof x === 'string' ? x : '')

export function toutiaoApi(config: ToutiaoConfig, canDeliver?: () => boolean): WorkbenchMode {
  return {
    routes: Object.values(paths),
    async handle(ctx) {
      const route = Object.entries(paths).find(([, p]) => p === ctx.path)?.[0]
      if (!route) return false
      const want = route === 'adopt' || route === 'draft' ? 'POST' : 'GET'
      if (ctx.method !== want) { ctx.json(405, { ok: false, code: 'method', error: `${want} required` }); return true }
      try {
        if (route === 'articles') {
          const data = await listArticles()
          const sink = canDeliver ? canDeliver() : false
          ctx.json(200, { ok: true, ...data, actions: [...TOUTIAO_ACTIONS], deliver: sink,
            deliverReason: sink ? undefined : '请先保存模型连接' })
        } else if (route === 'article') {
          const root = ctx.url.searchParams.get('root') ?? '', id = ctx.url.searchParams.get('id') ?? ''
          if (!root || !id) ctx.json(400, { ok: false, code: 'bad_request', error: '须指明 root 与 id' })
          else ctx.json(200, { ok: true, article: await articleDetail(root, id) })
        } else if (route === 'adopt') {
          const body = await ctx.body(16_000)
          if (!body) return true
          if (body.confirm !== true || !str(body.root) || !str(body.id)) ctx.json(400, { ok: false, code: 'confirmation_required', error: '须明确确认、数据目录与文章。' })
          else {
            const m = await adopt(str(body.root), str(body.id), { rev: body.expectedRev as number, sha256: str(body.expectedSha256) }, config)
            ctx.json(200, { ok: true, id: m.id, status: m.status })
          }
        } else if (route === 'draft') {
          const body = await ctx.body(1_000_000)
          if (!body) return true
          const text = typeof body.text === 'string' ? body.text : ''
          if (!str(body.root) || !str(body.id) || !text.trim() || !Number.isInteger(body.expectedRev) || Number(body.expectedRev) < 1 || typeof body.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedSha256)) ctx.json(400, { ok: false, code: 'bad_args', error: '须指明数据目录、文章、非空正文及实际已读版本。' })
          else {
            const saved = await saveAuthorDraft(str(body.root), str(body.id), text, { rev: body.expectedRev as number, sha256: str(body.expectedSha256) }, config)
            ctx.json(200, { ok: true, id: str(body.id), ...saved })
          }
        }

      } catch (err) { sendError(ctx, err) }
      return true
    },
  }
}
