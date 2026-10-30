/**
 * 写作台 · 方法方案接口（两种模式共用，挂在 /api/writer/<mode>/profiles 下）：
 *   GET  …/profiles                          全部方案与当前方案
 *   GET  …/profiles/detail?profile=          某方案的方法清单
 *   GET  …/profiles/method?profile=&id=      某方案下一份方法的全文（覆盖时附底稿全文）
 *   POST …/profiles/use    {profile}
 *   POST …/profiles/create {name?, base?, note?, files?: [{id,text}]}
 *   POST …/profiles/save   {profile, id, text}
 *   POST …/profiles/reset  {profile, id}
 *   POST …/profiles/rename {profile, name, note?}
 *   POST …/profiles/delete {profile, confirm: true}
 * 这里不依赖写作台包（同层），上下文按结构对上 RouteContext 即可。
 */
import { WriterError } from '../../host/src/index.js'
import {
  createProfile, deleteProfile, findProfile, listProfiles, profileDetail, readMethod, renameProfile, resetMethod, saveMethod, useProfile,
  type MethodLibrary,
} from './profiles.js'

export interface ProfileRouteContext {
  url: URL
  path: string
  method: string
  json(status: number, body: unknown): void
  body(limit?: number): Promise<Record<string, unknown> | undefined>
}

const GETS = ['', '/detail', '/method'] as const
const POSTS = ['/use', '/create', '/save', '/reset', '/rename', '/delete'] as const
const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')

function fail(ctx: ProfileRouteContext, err: unknown) {
  if (err instanceof WriterError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'INVALID_ARGS' || err.code === 'OUT_OF_ROOT' ? 400 : 409
    return ctx.json(status, { ok: false, code: err.code, error: err.message })
  }
  ctx.json(500, { ok: false, code: 'failed', error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) })
}

export function profileRoutes(base: string, lib: MethodLibrary, pinned?: () => string | undefined) {
  const root = `${base}/profiles`
  const routes = [...GETS, ...POSTS].map(s => root + s)
  async function handle(ctx: ProfileRouteContext): Promise<boolean> {
    if (!routes.includes(ctx.path)) return false
    const sub = ctx.path.slice(root.length)
    const want = (GETS as readonly string[]).includes(sub) ? 'GET' : 'POST'
    if (ctx.method !== want) { ctx.json(405, { ok: false, code: 'method', error: `${want} required` }); return true }
    const pin = pinned?.()
    try {
      if (sub === '') return ctx.json(200, { ok: true, mode: lib.mode, ...(await listProfiles(lib, pin)) }), true
      if (sub === '/detail') return ctx.json(200, { ok: true, ...(await profileDetail(lib, ctx.url.searchParams.get('profile') || 'default', pin)) }), true
      if (sub === '/method') {
        const profile = ctx.url.searchParams.get('profile') || 'default', id = ctx.url.searchParams.get('id') || ''
        if (!id) return ctx.json(400, { ok: false, code: 'bad_request', error: '须指明方法 id' }), true
        const m = await readMethod(lib, profile, id, pin)
        let baseText: string | undefined
        if (m.from === 'user') {
          const meta = await findProfile(lib.mode, profile)
          baseText = await readMethod(lib, meta.base ?? 'default', m.id, pin).then(b => b.text).catch(() => undefined)
        }
        return ctx.json(200, { ok: true, method: m, base_text: baseText }), true
      }
      const body = await ctx.body(sub === '/create' ? 4_000_000 : 400_000)
      if (!body) return true
      if (sub === '/use') ctx.json(200, { ok: true, profile: await useProfile(lib.mode, str(body.profile), pin) })
      else if (sub === '/create') {
        const files = Array.isArray(body.files) ? body.files.map(f => ({ id: str((f as Record<string, unknown>)?.id), text: String((f as Record<string, unknown>)?.text ?? '') })) : []
        ctx.json(200, { ok: true, profile: await createProfile(lib, { name: str(body.name) || undefined, base: str(body.base) || undefined, note: str(body.note) || undefined, files }) })
      } else if (sub === '/save') ctx.json(200, { ok: true, ...(await saveMethod(lib, str(body.profile), str(body.id), body.text)) })
      else if (sub === '/reset') ctx.json(200, { ok: true, ...(await resetMethod(lib, str(body.profile), str(body.id))) })
      else if (sub === '/rename') ctx.json(200, { ok: true, profile: await renameProfile(lib.mode, str(body.profile), str(body.name), typeof body.note === 'string' ? body.note : undefined) })
      else {
        if (body.confirm !== true) ctx.json(400, { ok: false, code: 'confirmation_required', error: '删除方案须明确确认' })
        else ctx.json(200, { ok: true, ...(await deleteProfile(lib.mode, str(body.profile))) })
      }
    } catch (err) { fail(ctx, err) }
    return true
  }
  return { routes, handle }
}
