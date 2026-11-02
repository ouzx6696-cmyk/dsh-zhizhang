export const API = '/api/writer'

export interface RouteContext {
  url: URL
  /** 去掉末尾斜杠的路径 */
  path: string
  method: string
  json(status: number, body: unknown): void
  body(limit?: number): Promise<Record<string, unknown> | undefined>
}

export interface WorkbenchMode {
  routes: string[]
  handle(ctx: RouteContext): Promise<boolean>
}

export const ROUTES = {
  projects: '/projects', snapshot: '/snapshot', chapter: '/chapter', saveChapter: '/chapter/save',
  reviewChapter: '/chapter/review', finalizeChapter: '/chapter/finalize',
  candidate: '/candidate', diagnose: '/diagnostics/scan', stageRevision: '/diagnostics/stage',
  accept: '/candidate/accept', acknowledge: '/revision/acknowledge', unifyPrepare: '/unify/prepare',
  capabilities: '/diagnostics/capabilities', deliver: '/agent/deliver',
  articles: '/toutiao/articles', article: '/toutiao/article', adoptArticle: '/toutiao/adopt',
  saveArticle: '/toutiao/draft', deliverArticle: '/toutiao/agent/deliver',
} as const

export function sendError(ctx: Pick<RouteContext, 'json'>, error: unknown) {
  const domain = error instanceof Error && ['WriterError', 'NovelError'].includes(error.name)
  const code = domain && 'code' in error && typeof error.code === 'string' ? error.code : 'failed'
  const status = code === 'NOT_FOUND' || code.endsWith('_not_found') ? 404
    : code === 'body_too_large' ? 413
    : code === 'INVALID_ARGS' || code === 'OUT_OF_ROOT' || code.startsWith('bad_') || code === 'too_many_paragraphs' ? 400
    : code !== 'failed' ? 409 : 500
  ctx.json(status, { ok: false, code, error: error instanceof Error ? error.message : String(error) })
}
