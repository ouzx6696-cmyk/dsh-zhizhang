/**
 * 方法方案：模型读取的方法论按"方案"组织，每种写作模式各有一套。
 *   default  默认    插件自带的精炼版（推荐）
 *   original 原版    上游原件，保留作参考与兜底
 *   user-N   用户方案N 作者提交的版本：以某个内置方案为底，逐份覆盖或新增
 * 读取顺序：用户方案的覆盖 → 它的底（默认或原版）；默认里没有的 id 回落到原版。
 * 当前方案存在 <方案目录>/active.json；配置 <mode>.profile 可以钉死。
 * 方案目录：配置 profilesDir → WRITER_PROFILES_DIR → $DSH_HOME/writer/profiles → ~/.dsh-writer/profiles。
 */
import { readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { WriterError } from '../../host/src/index.js'
import { atomicWrite, readJson, readText, resolveInside } from './fsx.js'

export type ProfileMode = 'toutiao' | 'fanqie'
export type BuiltinProfile = 'default' | 'original'
export const BUILTIN_NAMES: Record<BuiltinProfile, string> = { default: '默认', original: '原版' }
export const BUILTIN_NOTES: Record<BuiltinProfile, string> = {
  default: '插件精炼版：去重、去空话、对齐质检规则与工具（推荐）',
  original: '上游原件，未改动；作参考与兜底',
}
export const PROFILE_LIMITS = { textBytes: 256 * 1024, methodsPerProfile: 300, profilesPerMode: 20, nameChars: 24 } as const

export interface MethodText { id: string; text: string; file: string; title?: string }
export interface MethodEntry { id: string; title?: string }

/** 每种模式提供：两个内置方案的目录与读取 */
export interface MethodLibrary {
  mode: ProfileMode
  defaultIds(): Promise<MethodEntry[]>
  originalIds(): Promise<string[]>
  /** id 已规范化；读不到返回 undefined */
  readDefault(id: string): Promise<MethodText | undefined>
  readOriginal(id: string): Promise<MethodText | undefined>
  /** 原版 id 或别名 → 默认方案 id（找不到原样返回） */
  canonical(id: string): string
}

export interface ProfileMeta {
  id: string
  name: string
  mode: ProfileMode
  kind: 'builtin' | 'user'
  base?: BuiltinProfile
  note?: string
  created_at?: string
  updated_at?: string
}

export interface ResolvedMethod extends MethodText {
  profile: string
  profile_name: string
  /** 这份内容实际来自哪里 */
  from: 'user' | BuiltinProfile
}

let configuredRoot: string | undefined
export function setProfilesRoot(dir: string | undefined) { configuredRoot = dir?.trim() || undefined }
export function profilesRoot(): string {
  if (configuredRoot) return path.resolve(configuredRoot)
  if (process.env.WRITER_PROFILES_DIR?.trim()) return path.resolve(process.env.WRITER_PROFILES_DIR.trim())
  if (process.env.DSH_HOME?.trim()) return path.join(path.resolve(process.env.DSH_HOME.trim()), 'writer', 'profiles')
  return path.join(homedir(), '.dsh-writer', 'profiles')
}

const nowIso = () => new Date().toISOString()
const modeDir = (mode: ProfileMode) => path.join(profilesRoot(), mode)
const isBuiltin = (id: string): id is BuiltinProfile => id === 'default' || id === 'original'
const USER_ID = /^user-(\d{1,3})$/

const DIGITS = '零一二三四五六七八九'
/** 1 → 一，10 → 十，12 → 十二，25 → 二十五 */
export function chineseNumber(n: number): string {
  if (n < 10) return DIGITS[n]!
  if (n < 20) return '十' + (n % 10 ? DIGITS[n % 10] : '')
  if (n < 100) return DIGITS[Math.floor(n / 10)] + '十' + (n % 10 ? DIGITS[n % 10] : '')
  return String(n)
}

/** 方法 id：中文、字母、数字、- _ . /，不能越级 */
export function checkMethodId(id: string): string {
  const clean = id.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/\.md$/i, '')
  // eslint-disable-next-line no-control-regex
  if (!clean || clean.length > 120 || /[\u0000-\u001f<>:"|?*]/.test(clean) || clean.split('/').some(s => s === '..' || s === '.' || !s.trim())) {
    throw new WriterError('INVALID_ARGS', `方法 id 不合法：${id}（不能含 < > : " | ? * 或越级路径）`)
  }
  return clean
}

function checkName(name: string): string {
  const n = name.trim()
  if (!n || [...n].length > PROFILE_LIMITS.nameChars || /[\r\n\t]/.test(n)) throw new WriterError('INVALID_ARGS', `方案名须为 1–${PROFILE_LIMITS.nameChars} 个字`)
  return n
}

function checkText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw new WriterError('INVALID_ARGS', '方法内容不能为空')
  if (Buffer.byteLength(text) > PROFILE_LIMITS.textBytes) throw new WriterError('INVALID_ARGS', `单份方法不能超过 ${PROFILE_LIMITS.textBytes / 1024}KB`)
  return text.replace(/\r\n/g, '\n')
}

async function userMetas(mode: ProfileMode): Promise<ProfileMeta[]> {
  const out: ProfileMeta[] = []
  for (const e of await readdir(modeDir(mode), { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || !USER_ID.test(e.name)) continue
    const m = await readJson<ProfileMeta>(path.join(modeDir(mode), e.name, 'profile.json'))
    if (m?.id === e.name) out.push({ ...m, mode, kind: 'user', base: m.base === 'original' ? 'original' : 'default' })
  }
  return out.sort((a, b) => Number(a.id.match(USER_ID)![1]) - Number(b.id.match(USER_ID)![1]))
}

function builtinMeta(mode: ProfileMode, id: BuiltinProfile): ProfileMeta {
  return { id, name: BUILTIN_NAMES[id], mode, kind: 'builtin', note: BUILTIN_NOTES[id] }
}

/** 按 id 或名称找方案（"用户方案一"、"默认" 都行） */
export async function findProfile(mode: ProfileMode, key: string): Promise<ProfileMeta> {
  const k = key.trim()
  if (isBuiltin(k)) return builtinMeta(mode, k)
  for (const b of ['default', 'original'] as const) if (BUILTIN_NAMES[b] === k) return builtinMeta(mode, b)
  const users = await userMetas(mode)
  const hit = users.find(u => u.id === k || u.name === k)
  if (!hit) throw new WriterError('NOT_FOUND', `没有这个方案：${key}。可选：默认、原版${users.length ? '、' + users.map(u => u.name).join('、') : ''}`)
  return hit
}

async function overrideIds(mode: ProfileMode, id: string): Promise<string[]> {
  const root = path.join(modeDir(mode), id, 'methods')
  const out: string[] = []
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile() && e.name.endsWith('.md')) out.push(path.relative(root, p).split(path.sep).join('/').replace(/\.md$/, ''))
    }
  }
  await walk(root)
  return out.sort()
}

/* ---------------- 当前方案 ---------------- */

const activeFile = () => path.join(profilesRoot(), 'active.json')

export async function activeProfile(mode: ProfileMode, pinned?: string): Promise<ProfileMeta & { pinned: boolean }> {
  if (pinned) {
    const m = await findProfile(mode, pinned).catch(() => undefined)
    if (m) return { ...m, pinned: true }
  }
  const saved = (await readJson<Record<string, string>>(activeFile()))?.[mode]
  if (saved) {
    const m = await findProfile(mode, saved).catch(() => undefined)
    if (m) return { ...m, pinned: false }
  }
  return { ...builtinMeta(mode, 'default'), pinned: false }
}

export async function useProfile(mode: ProfileMode, key: string, pinned?: string): Promise<ProfileMeta> {
  const m = await findProfile(mode, key)
  if (pinned && (await findProfile(mode, pinned).catch(() => undefined))) {
    throw new WriterError('CONFLICT', `配置里 ${mode}.profile 已固定为「${pinned}」，要切换请先改配置`)
  }
  const cur = (await readJson<Record<string, string>>(activeFile())) ?? {}
  cur[mode] = m.id
  await atomicWrite(activeFile(), JSON.stringify(cur, null, 2) + '\n')
  return m
}

/* ---------------- 读方法 ---------------- */

/** 前缀 原版: / original: 强制读原件；默认: / default: 强制读默认 */
function forced(id: string): { force?: BuiltinProfile; id: string } {
  const m = id.match(/^(原版|original|默认|default)[:：](.+)$/)
  if (!m) return { id }
  return { force: m[1] === '原版' || m[1] === 'original' ? 'original' : 'default', id: m[2]! }
}

async function readBuiltin(lib: MethodLibrary, which: BuiltinProfile, id: string): Promise<{ hit: MethodText; from: BuiltinProfile } | undefined> {
  if (which === 'default') {
    const d = await lib.readDefault(lib.canonical(id))
    if (d) return { hit: d, from: 'default' }
  }
  const o = await lib.readOriginal(id)
  return o ? { hit: o, from: 'original' } : undefined
}

export async function readMethod(lib: MethodLibrary, profileKey: string | undefined, rawId: string, pinned?: string): Promise<ResolvedMethod> {
  const meta = profileKey ? await findProfile(lib.mode, profileKey) : await activeProfile(lib.mode, pinned)
  const { force, id: idPart } = forced(rawId.trim())
  const id = checkMethodId(idPart)
  if (force) {
    const r = await readBuiltin(lib, force, id)
    if (!r || (force === 'default' && r.from !== 'default')) throw new WriterError('NOT_FOUND', `${BUILTIN_NAMES[force]}方案里没有：${id}`)
    return { ...r.hit, profile: force, profile_name: BUILTIN_NAMES[force], from: r.from }
  }
  if (meta.kind === 'user') {
    const dir = path.join(modeDir(lib.mode), meta.id, 'methods')
    for (const cand of [id, lib.canonical(id)]) {
      const text = await readText(resolveInside(dir, `${cand}.md`))
      if (text !== undefined) return { id: cand, text, file: `${meta.name}/${cand}.md`, profile: meta.id, profile_name: meta.name, from: 'user' }
    }
  }
  const base: BuiltinProfile = meta.kind === 'user' ? meta.base ?? 'default' : (meta.id as BuiltinProfile)
  const r = await readBuiltin(lib, base, id)
  if (!r) throw new WriterError('NOT_FOUND', `「${meta.name}」方案里没有这份方法：${id}`)
  return { ...r.hit, profile: meta.id, profile_name: meta.name, from: r.from }
}

/* ---------------- 列表与详情 ---------------- */

export interface ProfileSummary extends ProfileMeta { active: boolean; pinned: boolean; methods: number; overrides?: number }

export async function listProfiles(lib: MethodLibrary, pinned?: string): Promise<{ active: string; pinned: boolean; profiles: ProfileSummary[] }> {
  const act = await activeProfile(lib.mode, pinned)
  const def = await lib.defaultIds()
  const orig = await lib.originalIds()
  const out: ProfileSummary[] = [
    { ...builtinMeta(lib.mode, 'default'), active: act.id === 'default', pinned: act.pinned && act.id === 'default', methods: def.length },
    { ...builtinMeta(lib.mode, 'original'), active: act.id === 'original', pinned: act.pinned && act.id === 'original', methods: orig.length },
  ]
  for (const u of await userMetas(lib.mode)) {
    const ov = await overrideIds(lib.mode, u.id)
    const baseIds = u.base === 'original' ? orig : def.map(d => d.id)
    out.push({ ...u, active: act.id === u.id, pinned: act.pinned && act.id === u.id, methods: new Set([...baseIds, ...ov]).size, overrides: ov.length })
  }
  return { active: act.id, pinned: act.pinned, profiles: out }
}

export interface ProfileMethodRow { id: string; title?: string; from: 'user' | BuiltinProfile; overridden: boolean; added?: boolean }

export async function profileDetail(lib: MethodLibrary, key: string, pinned?: string): Promise<{ profile: ProfileSummary; methods: ProfileMethodRow[] }> {
  const meta = await findProfile(lib.mode, key)
  const list = await listProfiles(lib, pinned)
  const summary = list.profiles.find(p => p.id === meta.id)!
  const def = await lib.defaultIds()
  const titles = new Map(def.map(d => [d.id, d.title]))
  if (meta.id === 'default') return { profile: summary, methods: def.map(d => ({ id: d.id, title: d.title, from: 'default', overridden: false })) }
  if (meta.id === 'original') return { profile: summary, methods: (await lib.originalIds()).map(id => ({ id, from: 'original', overridden: false })) }
  const ov = new Set(await overrideIds(lib.mode, meta.id))
  const baseIds = meta.base === 'original' ? await lib.originalIds() : def.map(d => d.id)
  const rows: ProfileMethodRow[] = baseIds.map(id => ({ id, title: titles.get(id), from: ov.has(id) ? 'user' : meta.base ?? 'default', overridden: ov.has(id) }))
  for (const id of ov) if (!baseIds.includes(id)) rows.push({ id, from: 'user', overridden: true, added: true })
  return { profile: summary, methods: rows }
}

/* ---------------- 用户方案：新建、保存、恢复、改名、删除 ---------------- */

export interface CreateProfileInput {
  name?: string
  /** default / original，或已有用户方案（复制它的覆盖与底） */
  base?: string
  note?: string
  files?: { id: string; text: string }[]
}

export async function createProfile(lib: MethodLibrary, input: CreateProfileInput = {}): Promise<ProfileMeta> {
  const users = await userMetas(lib.mode)
  if (users.length >= PROFILE_LIMITS.profilesPerMode) throw new WriterError('CONFLICT', `每种模式最多 ${PROFILE_LIMITS.profilesPerMode} 个用户方案，先删掉不用的`)
  const n = users.reduce((mx, u) => Math.max(mx, Number(u.id.match(USER_ID)![1])), 0) + 1
  const id = `user-${n}`
  const name = input.name?.trim() ? checkName(input.name) : `用户方案${chineseNumber(n)}`
  if ([...users.map(u => u.name), ...Object.values(BUILTIN_NAMES)].includes(name)) throw new WriterError('CONFLICT', `已有同名方案：${name}`)
  let base: BuiltinProfile = 'default'
  let copyFrom: ProfileMeta | undefined
  if (input.base) {
    const b = await findProfile(lib.mode, input.base)
    if (b.kind === 'user') { copyFrom = b; base = b.base ?? 'default' } else base = b.id as BuiltinProfile
  }
  const files = input.files ?? []
  if (files.length > PROFILE_LIMITS.methodsPerProfile) throw new WriterError('INVALID_ARGS', `一次最多 ${PROFILE_LIMITS.methodsPerProfile} 份`)
  const checked = files.map(f => ({ id: lib.canonical(checkMethodId(f.id)), text: checkText(f.text) }))
  const dir = path.join(modeDir(lib.mode), id)
  const at = nowIso()
  const meta: ProfileMeta = { id, name, mode: lib.mode, kind: 'user', base, note: input.note?.trim().slice(0, 200) || undefined, created_at: at, updated_at: at }
  if (copyFrom) {
    for (const mid of await overrideIds(lib.mode, copyFrom.id)) {
      const text = await readText(resolveInside(path.join(modeDir(lib.mode), copyFrom.id, 'methods'), `${mid}.md`))
      if (text !== undefined) await atomicWrite(resolveInside(dir, 'methods', `${mid}.md`), text)
    }
  }
  for (const f of checked) await atomicWrite(resolveInside(dir, 'methods', `${f.id}.md`), f.text)
  await atomicWrite(path.join(dir, 'profile.json'), JSON.stringify(meta, null, 2) + '\n')
  return meta
}

async function touch(mode: ProfileMode, meta: ProfileMeta, patch: Partial<ProfileMeta> = {}) {
  const next = { ...meta, ...patch, updated_at: nowIso() }
  await atomicWrite(path.join(modeDir(mode), meta.id, 'profile.json'), JSON.stringify(next, null, 2) + '\n')
  return next
}

async function editable(mode: ProfileMode, key: string): Promise<ProfileMeta> {
  const meta = await findProfile(mode, key)
  if (meta.kind !== 'user') throw new WriterError('CONFLICT', `「${meta.name}」是内置方案，不能修改；新建一个用户方案再改`)
  return meta
}

export async function saveMethod(lib: MethodLibrary, key: string, id: string, text: unknown): Promise<{ profile: ProfileMeta; id: string; bytes: number }> {
  const meta = await editable(lib.mode, key)
  const mid = lib.canonical(checkMethodId(id))
  const body = checkText(text)
  const existing = await overrideIds(lib.mode, meta.id)
  if (!existing.includes(mid) && existing.length >= PROFILE_LIMITS.methodsPerProfile) throw new WriterError('CONFLICT', `一个方案最多 ${PROFILE_LIMITS.methodsPerProfile} 份覆盖`)
  await atomicWrite(resolveInside(path.join(modeDir(lib.mode), meta.id, 'methods'), `${mid}.md`), body)
  return { profile: await touch(lib.mode, meta), id: mid, bytes: Buffer.byteLength(body) }
}

export async function resetMethod(lib: MethodLibrary, key: string, id: string): Promise<{ profile: ProfileMeta; id: string; removed: boolean }> {
  const meta = await editable(lib.mode, key)
  const mid = lib.canonical(checkMethodId(id))
  const file = resolveInside(path.join(modeDir(lib.mode), meta.id, 'methods'), `${mid}.md`)
  const had = !!(await stat(file).catch(() => undefined))
  if (had) await rm(file, { force: true })
  return { profile: await touch(lib.mode, meta), id: mid, removed: had }
}

export async function renameProfile(mode: ProfileMode, key: string, name: string, note?: string): Promise<ProfileMeta> {
  const meta = await editable(mode, key)
  const n = checkName(name)
  const others = (await userMetas(mode)).filter(u => u.id !== meta.id).map(u => u.name)
  if ([...others, ...Object.values(BUILTIN_NAMES)].includes(n)) throw new WriterError('CONFLICT', `已有同名方案：${n}`)
  return touch(mode, meta, { name: n, ...(note !== undefined ? { note: note.trim().slice(0, 200) || undefined } : {}) })
}

export async function deleteProfile(mode: ProfileMode, key: string): Promise<{ id: string; was_active: boolean }> {
  const meta = await editable(mode, key)
  const cur = (await readJson<Record<string, string>>(activeFile())) ?? {}
  const wasActive = cur[mode] === meta.id
  if (wasActive) { delete cur[mode]; await atomicWrite(activeFile(), JSON.stringify(cur, null, 2) + '\n') }
  await rm(path.join(modeDir(mode), meta.id), { recursive: true, force: true })
  return { id: meta.id, was_active: wasActive }
}
