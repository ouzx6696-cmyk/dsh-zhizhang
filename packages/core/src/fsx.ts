/** 文件工具：原子写、根目录越界检查、按路径串行化。只用 Node 标准库。 */
import { mkdir, readdir, readFile, rename, open, lstat, rm, stat } from 'node:fs/promises'
import { randomBytes, createHash } from 'node:crypto'
import path from 'node:path'
import { WriterError } from './tool.js'

/** 把 rel 解析到 root 下；越界（含 .. 与绝对路径跳出）抛 OUT_OF_ROOT。 */
export function resolveInside(root: string, ...rel: string[]): string {
  const base = path.resolve(root)
  const target = path.resolve(base, ...rel)
  const relative = path.relative(base, target)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return target
  throw new WriterError('OUT_OF_ROOT', `路径越界：${rel.join('/')}`)
}

/** Reject links and non-directory ancestors before publishing a local file. Returns true if immediate parent exists. */
export async function assertSafeAncestors(file: string): Promise<boolean> {
  const immediate = path.resolve(path.dirname(file))
  let immediateExists = false
  for (let current = immediate; ; current = path.dirname(current)) {
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new WriterError('unsafe_path', `写入路径包含链接或非目录，拒绝越界风险：${current}`)
      if (current === immediate) immediateExists = true
    } catch (error) { if (!isMissingFileError(error)) throw error }
    if (current === path.dirname(current)) break
  }
  return immediateExists
}

export async function atomicWrite(file: string, data: string): Promise<void> {
  const parentReady = await assertSafeAncestors(file)
  if (!parentReady) {
    await mkdir(path.dirname(file), { recursive: true })
    await assertSafeAncestors(file)
  }
  try {
    if ((await lstat(file)).isSymbolicLink())
      throw new WriterError('unsafe_path', `拒绝覆盖链接资产：${file}`)
  } catch (error) { if (!isMissingFileError(error)) throw error }
  const tmp = `${file}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`
  const handle = await open(tmp, 'wx')
  try {
    try { await handle.writeFile(data, 'utf8'); await handle.sync() }
    finally { await handle.close() }
    await rename(tmp, file)
  } catch (error) {
    try { await rm(tmp, { force: true }) }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], '原子写入失败，临时文件清理也失败') }
    throw error
  }
}

export function isMissingFileError(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Missing directories are empty; permission and IO errors remain visible. */
export async function listDir(dir: string) {
  try { return await readdir(dir, { withFileTypes: true }) }
  catch (error) {
    if (isMissingFileError(error)) return []
    throw error
  }
}

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, 'utf8')
  } catch (err) {
    if (isMissingFileError(err)) return undefined
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
  try { await stat(p); return true } catch (error) { if (isMissingFileError(error)) return false; throw error }
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}

export function shortId(prefix: string, n = 12): string {
  if (!Number.isSafeInteger(n) || n < 1 || n > 64) throw new RangeError('ID 长度必须为 1–64')
  return `${prefix}-${randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n)}`
}

/** 同一进程内对同一 key 的异步操作串行执行（防止并发读改写 meta.json 丢更新）。 */
const chains = new Map<string, Promise<unknown>>()
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  // allow-catch: queue continuation only; the original rejecting promise is returned to the caller.
  const tail = run.catch(() => undefined)
  chains.set(key, tail)
  void tail.then(() => { if (chains.get(key) === tail) chains.delete(key) })
  return run
}

/** UTC timestamps compare independently of the machine timezone. */
export function nowIso(date: Date = new Date()): string { return date.toISOString() }
