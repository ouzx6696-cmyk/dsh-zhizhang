/** 方法方案管理工具（toutiao_profile / fanqie_profile 共用实现）。删除方案只在写作台做（要确认）。 */
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { defineWriterTool, sessionCwd, WriterError, type HostContext, type HostToolDefinition, type JsonSchemaNode } from '../../host/src/index.js'
import { readText, resolveInside } from './fsx.js'
import {
  createProfile, listProfiles, PROFILE_LIMITS, profileDetail, renameProfile, resetMethod, saveMethod, useProfile, type MethodLibrary,
} from './profiles.js'

const S = (description: string): JsonSchemaNode => ({ type: 'string', description })
const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')

/** 读会话目录下的一个文件夹里的 .md，作为一组方法 */
export async function readMethodFolder(dir: string): Promise<{ id: string; text: string }[]> {
  const out: { id: string; text: string }[] = []
  const walk = async (d: string, depth: number) => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      if (e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (depth < 4) await walk(p, depth + 1); continue }
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue
      if (out.length >= PROFILE_LIMITS.methodsPerProfile) return
      const text = await readText(p)
      if (text?.trim()) out.push({ id: path.relative(dir, p).split(path.sep).join('/').replace(/\.md$/i, ''), text })
    }
  }
  await walk(dir, 1)
  return out
}

export function createProfileTool(name: string, lib: MethodLibrary, opts: { pinned?: string; host?: HostContext; methodTool: string }): HostToolDefinition {
  return defineWriterTool<Record<string, unknown>>({
    name,
    description: `管理方法方案：模型读取的方法论按方案组织——默认（精炼版，推荐）、原版（上游原件）、用户方案一/二…（作者提交的版本，逐份覆盖默认或原版）。${opts.methodTool} 按当前方案取。`
      + 'action：list 看全部方案；show 看某方案的方法清单（省略 profile 看当前）；use 切换当前方案；create 新建用户方案（name 可省，自动叫"用户方案N"；base=默认/原版/某用户方案；from_dir=会话目录下装着 .md 的文件夹，文件名即方法 id）；'
      + 'save 给用户方案存一份方法（method + text，或 file=会话目录下的 .md）；reset 删掉一份覆盖、恢复底稿；rename 改名。只在作者明确要求时切换或修改方案。',
    properties: {
      action: { type: 'string', enum: ['list', 'show', 'use', 'create', 'save', 'reset', 'rename'], description: '操作' },
      profile: S('方案：默认 / 原版 / 用户方案名或 id（user-1）'),
      name: S('create / rename：方案名'),
      base: S('create：底稿方案，默认"默认"'),
      note: S('create / rename：一句说明'),
      from_dir: S('create：会话目录下的文件夹，里面的 .md 作为这个方案的覆盖'),
      method: S('save / reset：方法 id'),
      text: S('save：方法全文（Markdown）'),
      file: S('save：会话目录下的 .md 文件，代替 text'),
    },
    required: ['action'],
    async run(args, exec) {
      const action = str(args.action)
      const cwd = sessionCwd(exec, opts.host)
      const profile = str(args.profile)
      const need = (v: string, k: string) => { if (!v) throw new WriterError('INVALID_ARGS', `参数 ${k} 必填`); return v }
      switch (action) {
        case 'list': return await listProfiles(lib, opts.pinned)
        case 'show': {
          const key = profile || (await listProfiles(lib, opts.pinned)).active
          return await profileDetail(lib, key, opts.pinned)
        }
        case 'use': return { profile: await useProfile(lib.mode, need(profile, 'profile'), opts.pinned) }
        case 'create': {
          let files: { id: string; text: string }[] = []
          const dir = str(args.from_dir)
          if (dir) {
            const abs = resolveInside(cwd, dir)
            if (!(await stat(abs).catch(() => undefined))?.isDirectory()) throw new WriterError('NOT_FOUND', `文件夹不存在：${dir}`)
            files = await readMethodFolder(abs)
            if (!files.length) throw new WriterError('INVALID_ARGS', `${dir} 里没有 .md 文件`)
          }
          const meta = await createProfile(lib, { name: str(args.name) || undefined, base: str(args.base) || undefined, note: str(args.note) || undefined, files })
          return { profile: meta, imported: files.map(f => f.id), next: `用 ${name} action=use profile=${meta.name} 切换过去` }
        }
        case 'save': {
          let text: unknown = args.text
          const file = str(args.file)
          if (file) {
            text = await readText(resolveInside(cwd, file))
            if (text === undefined) throw new WriterError('NOT_FOUND', `文件不存在：${file}`)
          }
          return await saveMethod(lib, need(profile, 'profile'), need(str(args.method), 'method'), text)
        }
        case 'reset': return await resetMethod(lib, need(profile, 'profile'), need(str(args.method), 'method'))
        case 'rename': return { profile: await renameProfile(lib.mode, need(profile, 'profile'), need(str(args.name), 'name'), typeof args.note === 'string' ? args.note : undefined) }
        default: throw new WriterError('INVALID_ARGS', `未知操作：${action}`)
      }
    },
  })
}
