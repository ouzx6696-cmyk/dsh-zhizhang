import type { IncomingMessage } from 'node:http'

/** 本机写作台只允许本机来源、可信 Host 和同源请求。 */
export function isLocalPanelRequest(req: IncomingMessage): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress ?? '')) return false
  const host = req.headers.host
  if (typeof host !== 'string') return false
  try {
    const url = new URL(`http://${host}`)
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) return false
    const origin = req.headers.origin
    if (origin && new URL(origin).host !== url.host) return false
    return true
  } catch {
    return false
  }
}
