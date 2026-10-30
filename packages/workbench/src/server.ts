/**
 * 写作工作台的 HTTP 层：两种模式共用一套访问校验、限流、JSON 读写与路由注册。
 *
 * - 默认只接受本机（回环地址 + 本机 Host）；allowLan 时接受局域网，Host 必须是本机地址或 hosts 白名单。
 * - 配了 token 时每个请求都要带（Authorization: Bearer 或 x-writer-token）。
 * - 带 Origin 的请求，Origin 必须与 Host 同源（防跨站提交）。
 * - 每个客户端每分钟最多 120 个 GET、20 个 POST（写作台约 6 秒轮询一次）。
 *
 * 各模式提供 { routes, handle }：handle 返回 true 表示已处理；都不处理时回 404。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { registerRoutes, type HostContext } from '../../host/src/index.js'

export const API = '/api/writer'

export interface WorkbenchAccess {
  /** 允许局域网访问，默认 false */
  allowLan?: boolean
  /** 局域网访问时接受的主机名；缺省为本机网卡地址 */
  hosts?: string[]
  /** 访问令牌；配置后本机与局域网请求都须携带 */
  token?: string
}

export interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  /** 去掉末尾斜杠的路径 */
  path: string
  method: string
  json(status: number, body: unknown): void
  /** 读 JSON 请求体；失败时已经写好错误响应并返回 undefined */
  body(limit?: number): Promise<Record<string, unknown> | undefined>
}

export interface WorkbenchMode {
  routes: string[]
  handle(ctx: RouteContext): Promise<boolean>
}

export function writeJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  res.end(JSON.stringify(body))
}

function isLoopback(req: IncomingMessage) {
  const ra = req.socket?.remoteAddress ?? ''
  return ra === '127.0.0.1' || ra === '::1' || ra === '::ffff:127.0.0.1'
}

function sameHost(origin: string, host: string) {
  try { return new URL(origin).host === new URL(`http://${host}`).host } catch { return false }
}

function lanHosts(access: WorkbenchAccess): Set<string> {
  const hosts = new Set<string>()
  for (const h of access.hosts ?? []) {
    const raw = String(h ?? '').trim().toLowerCase().replace(/^https?:\/\//, '')
    if (!raw) continue
    try { hosts.add(new URL(`http://${raw}`).hostname) } catch { hosts.add(raw) }
  }
  if (hosts.size) return hosts
  try {
    for (const list of Object.values(networkInterfaces())) {
      for (const ni of list ?? []) {
        // 带 zone 的 IPv6（fe80::1%12）没法放进 Host 头
        if (!ni.internal && ni.address && !ni.address.includes('%')) hosts.add(ni.address.toLowerCase())
      }
    }
  } catch { /* 没有网卡信息 */ }
  return hosts
}

function tokenOk(req: IncomingMessage, access: WorkbenchAccess) {
  const expected = (access.token ?? '').trim()
  if (!expected) return true
  const auth = req.headers?.authorization
  let got = typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (!got) {
    const alt = req.headers?.['x-writer-token']
    if (typeof alt === 'string') got = alt.trim()
  }
  if (!got) return false
  const a = Buffer.from(got, 'utf8'), b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

export function isAllowed(req: IncomingMessage, access: WorkbenchAccess): boolean {
  const loopback = isLoopback(req)
  if (!loopback && access.allowLan !== true) return false
  const host = req.headers?.host
  if (typeof host !== 'string') return false
  let hostname: string
  try { hostname = new URL(`http://${host}`).hostname.toLowerCase() } catch { return false }
  const allowed = lanHosts(access)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
  if (loopback ? !local && !allowed.has(hostname) : !allowed.has(hostname)) return false
  if (!tokenOk(req, access)) return false
  const origin = req.headers?.origin
  if (typeof origin === 'string' && !sameHost(origin, host)) return false
  return true
}

function rateLimiter() {
  const windows = new Map<string, { start: number; gets: number; posts: number }>()
  return (key: string, post: boolean) => {
    const now = Date.now()
    let w = windows.get(key)
    if (!w || now - w.start >= 60_000) {
      if (windows.size > 512) windows.clear()
      w = { start: now, gets: 0, posts: 0 }
      windows.set(key, w)
    }
    return post ? ++w.posts <= 20 : ++w.gets <= 120
  }
}

class BodyError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0, settled = false
    const cleanup = () => {
      clearTimeout(timer)
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted); req.off('close', onClose)
    }
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      cleanup()
      if (error) {
        chunks.length = 0
        req.pause?.()
        // 留时间把错误响应写出去，再关掉没读完的流
        const closeTimer = setTimeout(() => req.destroy?.(), 1000)
        closeTimer.unref()
        req.once('close', () => clearTimeout(closeTimer))
        req.once('error', () => {})
        reject(error)
      } else resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) finish(new BodyError('body_too_large', '请求体超过大小上限'))
      else chunks.push(chunk)
    }
    const onEnd = () => finish()
    const onError = (e: Error) => finish(e)
    const onAborted = () => finish(new BodyError('request_aborted', '请求已中断'))
    const onClose = () => { if (!settled) onAborted() }
    const timer = setTimeout(() => finish(new BodyError('request_timeout', '请求体读取超时')), 30_000)
    timer.unref()
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onAborted); req.once('close', onClose)
  })
}

/** POST 请求体：content-type 检查 + 大小上限 + JSON 解析 */
export async function readJsonBody(req: IncomingMessage, limit = 64_000): Promise<{ parsed: Record<string, any>; err?: undefined } | { err: { status: number; payload: Record<string, unknown> }; parsed?: undefined }> {
  const ct = String(req.headers?.['content-type'] ?? '').split(';')[0]!.trim().toLowerCase()
  if (ct !== 'application/json') return { err: { status: 415, payload: { ok: false, code: 'bad_content_type', error: 'POST 请求体须为 application/json' } } }
  let raw = ''
  try { raw = await readBody(req, limit) } catch (err) {
    const code = err instanceof BodyError ? err.code : 'request_aborted'
    return { err: { status: code === 'body_too_large' ? 413 : code === 'request_timeout' ? 408 : 400, payload: { ok: false, code, error: err instanceof Error ? err.message : String(err) } } }
  }
  try {
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required')
    return { parsed }
  } catch {
    return { err: { status: 400, payload: { ok: false, code: 'bad_json', error: '请求体须为 JSON' } } }
  }
}

/** 组合各模式，得到一个带访问校验与限流的 HTTP 处理器 */
export function createWorkbenchHandler(access: WorkbenchAccess, modes: WorkbenchMode[]) {
  const allow = rateLimiter()
  const routes = [...new Set(modes.flatMap(m => m.routes))]
  async function handler(req: IncomingMessage, res: ServerResponse) {
    try {
      if (!isAllowed(req, access)) return writeJson(res, 403, { ok: false, code: 'forbidden', error: '写作台只接受本机访问（或按配置的局域网与令牌）' })
      const method = (req.method ?? 'GET').toUpperCase()
      if (!allow(String(req.socket?.remoteAddress ?? '?'), method === 'POST')) {
        res.setHeader?.('Retry-After', '60')
        return writeJson(res, 429, { ok: false, code: 'rate_limited', error: '请求过于频繁，请稍后再试' })
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const ctx: RouteContext = {
        req, res, url, method,
        path: url.pathname.replace(/\/+$/, '') || '/',
        json: (status, body) => writeJson(res, status, body),
        async body(limit) {
          const r = await readJsonBody(req, limit)
          if (r.err) { writeJson(res, r.err.status, r.err.payload); return undefined }
          return r.parsed
        },
      }
      for (const m of modes) if (await m.handle(ctx)) return
      writeJson(res, 404, { ok: false, code: 'not_found', error: `未知接口：${ctx.path}` })
    } catch (err) {
      if (!res.headersSent) writeJson(res, 500, { ok: false, code: 'internal', error: err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200) })
    }
  }
  return { routes, handler }
}

/** 挂到 DSH webServer（headless 没有 webServer 时什么也不做） */
export function registerWorkbench(ctx: HostContext, access: WorkbenchAccess, modes: WorkbenchMode[]): boolean {
  const { routes, handler } = createWorkbenchHandler(access, modes)
  return registerRoutes(ctx, routes.map(path => ({ path, handler: (req: IncomingMessage, res: ServerResponse) => { void handler(req, res) } })), 'dsh-writer: workbench')
}
