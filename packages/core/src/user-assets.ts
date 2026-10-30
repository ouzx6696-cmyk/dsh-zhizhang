/**
 * 作者自备资产：配置里 toutiao.assets / fanqie.assets 指定的目录。
 * 目录里的 .md / .txt / .json 按相对路径成为方法 id：user:<相对路径去扩展名>，
 * 经 toutiao_method_get / fanqie_forge_get 读取。只读，不覆盖插件自带的方法；
 * 自带方法的更新走 scripts/assets.mjs（见 docs/ASSETS.md）。
 */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { WriterError } from '../../host/src/index.js'
import { readText, resolveInside } from './fsx.js'

/** 资产配置段。dirs 之外的键现在一律报错；以后加键在这里登记（见 docs/ASSETS.md「预留」）。 */
export interface AssetsConfig {
  /** 作者自备方法 / 语料目录：绝对路径，或相对会话工作目录 */
  dirs?: string[]
}

export type AssetIssue = { message: string; path: (string | number)[] }

export const USER_PREFIX = 'user:'
export const USER_EXTS = ['.md', '.txt', '.json'] as const
/** 单份上限、每个目录最多收录多少份、最深几层：防止误指到大目录 */
export const USER_LIMITS = { fileBytes: 256 * 1024, filesPerDir: 300, depth: 4 } as const
const KNOWN = new Set(['dirs'])

export function parseAssetsConfig(input: unknown, at: string[]): { value?: AssetsConfig; issues: AssetIssue[] } {
  if (input === undefined || input === null) return { value: {}, issues: [] }
  if (typeof input !== 'object' || Array.isArray(input)) return { issues: [{ message: `${at.join('.')} 应为对象，如 { dirs: ["我的方法"] }`, path: at }] }
  const v = input as Record<string, unknown>
  const issues: AssetIssue[] = []
  for (const k of Object.keys(v)) if (!KNOWN.has(k)) issues.push({ message: `${[...at, k].join('.')} 不是有效配置项（现在只认 dirs）`, path: [...at, k] })
  const out: AssetsConfig = {}
  if (v.dirs !== undefined) {
    if (!(Array.isArray(v.dirs) && v.dirs.every(x => typeof x === 'string' && x.trim()))) issues.push({ message: `${[...at, 'dirs'].join('.')} 应为非空字符串数组`, path: [...at, 'dirs'] })
    else out.dirs = (v.dirs as string[]).map(x => x.trim())
  }
  return issues.length ? { issues } : { value: out, issues }
}

export interface UserAsset { id: string; dir: string; file: string; bytes: number }
export interface UserAssetList { assets: UserAsset[]; warnings: string[] }

const isUserExt = (name: string) => USER_EXTS.some(e => name.toLowerCase().endsWith(e))
const stripExt = (rel: string) => rel.replace(/\.(md|txt|json)$/i, '')

/** 列出作者自备资产；同 id 先到先得，其余记警告。目录不存在只警告，不报错。 */
export async function listUserAssets(cfg: AssetsConfig | undefined, cwd: string): Promise<UserAssetList> {
  const assets: UserAsset[] = []
  const warnings: string[] = []
  const seen = new Set<string>()
  for (const raw of cfg?.dirs ?? []) {
    const dir = path.resolve(cwd, raw)
    const st = await stat(dir).catch(() => undefined)
    if (!st?.isDirectory()) { warnings.push(`资产目录不存在：${raw}`); continue }
    let count = 0
    const walk = async (d: string, depth: number) => {
      const entries = await readdir(d, { withFileTypes: true }).catch(() => [])
      entries.sort((a, b) => a.name.localeCompare(b.name))
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === '__pycache__') continue
        const p = path.join(d, e.name)
        if (e.isDirectory()) { if (depth < USER_LIMITS.depth) await walk(p, depth + 1); continue }
        if (!e.isFile() || !isUserExt(e.name)) continue
        if (count >= USER_LIMITS.filesPerDir) { warnings.push(`${raw} 超过 ${USER_LIMITS.filesPerDir} 份，其余未收录`); return }
        const rel = path.relative(dir, p).split(path.sep).join('/')
        const id = USER_PREFIX + stripExt(rel)
        const size = (await stat(p)).size
        if (size > USER_LIMITS.fileBytes) { warnings.push(`${raw}/${rel} 超过 ${USER_LIMITS.fileBytes / 1024}KB，未收录`); continue }
        if (seen.has(id)) { warnings.push(`${id} 重名，用的是先列出的目录里那份`); continue }
        seen.add(id); count++
        assets.push({ id, dir: raw, file: rel, bytes: size })
      }
    }
    await walk(dir, 1)
  }
  return { assets, warnings }
}

/** 读一份作者自备资产；id 须以 user: 开头 */
export async function getUserAsset(cfg: AssetsConfig | undefined, cwd: string, id: string): Promise<{ id: string; file: string; text: string }> {
  if (!id.startsWith(USER_PREFIX)) throw new WriterError('INVALID_ARGS', `作者自备资产的 id 以 ${USER_PREFIX} 开头`)
  if (!cfg?.dirs?.length) throw new WriterError('NOT_FOUND', `没有配置作者自备资产目录（配置里的 assets.dirs）`)
  const want = id.slice(USER_PREFIX.length).replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\.(md|txt|json)$/i, '')
  const { assets } = await listUserAssets(cfg, cwd)
  const hit = assets.find(a => a.id === USER_PREFIX + want)
  if (!hit) {
    const near = assets.filter(a => a.id.includes(want.split('/').pop() ?? want)).slice(0, 8).map(a => a.id)
    throw new WriterError('NOT_FOUND', `没有这份自备资产：${id}。${near.length ? `相近的：${near.join('、')}` : `共 ${assets.length} 份，用 id=list 查看`}`)
  }
  const text = await readText(resolveInside(path.resolve(cwd, hit.dir), hit.file))
  if (text === undefined) throw new WriterError('NOT_FOUND', `读不到：${hit.dir}/${hit.file}`)
  return { id: hit.id, file: `${hit.dir}/${hit.file}`, text }
}
