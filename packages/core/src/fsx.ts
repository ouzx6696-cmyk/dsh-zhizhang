/** 文件工具：原子写、根目录越界检查、按路径串行化。只用 Node 标准库。 */
import { mkdir, readFile, rename, writeFile, rm, stat } from 'node:fs/promises'
import { randomBytes, createHash } from 'node:crypto'
import path from 'node:path'
import { WriterError } from '../../dsh-adapter/src/index.js'

/** 把 rel 解析到 root 下；越界（含 .. 与绝对路径跳出）抛 OUT_OF_ROOT。 */
export function resolveInside(root: string, ...rel: string[]): string {
  const base = path.resolve(root)
  const target = path.resolve(base, ...rel)
  const relative = path.relative(base, target)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return target
  throw new WriterError('OUT_OF_ROOT', `路径越界：${rel.join('/')}`)
}

/** 先写同目录临时文件再 rename，避免半截文件。 */
export async function atomicWrite(file: string, data: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    await writeFile(tmp, data, 'utf8')
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => undefined)
    throw err
  }
}

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (err: any) {
    if (err?.code === 'ENOENT') return undefined
    throw err
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  const t = await readText(file)
  if (t === undefined) return undefined
  try {
    return JSON.parse(t.replace(/^\uFEFF/, '')) as T
  } catch {
    throw new WriterError('CONFLICT', `JSON 文件损坏：${path.basename(file)}`)
  }
}

export async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true } catch { return false }
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/** 同一进程内对同一 key 的异步操作串行执行（防止并发读改写 meta.json 丢更新）。 */
const chains = new Map<string, Promise<unknown>>()
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  const tail = run.catch(() => undefined)
  chains.set(key, tail)
  void tail.then(() => { if (chains.get(key) === tail) chains.delete(key) })
  return run
}

/** 本地时间 + 时区偏移的 ISO 串 */
export function nowIso(d: Date = new Date()): string {
  // 本地时间 + 时区偏移（形如 YYYY-MM-DDTHH:mm:ss+08:00）。手工拼接，不依赖 toISOString。
  const p2 = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}${sign}${p2(off / 60)}:${p2(off % 60)}`
}

