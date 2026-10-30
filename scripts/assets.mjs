#!/usr/bin/env node
// 插件自带资产的清单与更新（说明见 docs/ASSETS.md）
//   node scripts/assets.mjs manifest                 重新生成 assets/manifest.json
//   node scripts/assets.mjs check                    清单、登记、版本号是否和磁盘一致（npm test 会跑）
//   node scripts/assets.mjs import <来源> <目录|zip>  比对上游新版，只出报告
//   node scripts/assets.mjs import <来源> <目录|zip> --apply   覆盖上游文件、改版本号、重建清单，报告存 assets/updates/
// 通用参数：--root <目录>  在另一份仓库副本上操作（测试用）
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name) => { const i = argv.indexOf(name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v }
const has = (name) => { const i = argv.indexOf(name); if (i < 0) return false; argv.splice(i, 1); return true }
const ROOT = path.resolve(flag('--root') ?? SCRIPT_ROOT)
const APPLY = has('--apply')
const [cmd, ...rest] = argv

const SKIP = new Set(['__pycache__', '.git', '.DS_Store', 'node_modules', 'Thumbs.db'])
const posix = (p) => p.split(path.sep).join('/')
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

async function walk(dir, base = dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name) || e.name.endsWith('.pyc')) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p, base, out)
    else if (e.isFile()) out.push(posix(path.relative(base, p)))
  }
  return out.sort()
}

const loadSources = async () => JSON.parse(await readFile(path.join(ROOT, 'assets/sources.json'), 'utf8'))
const saveSources = (s) => writeFile(path.join(ROOT, 'assets/sources.json'), JSON.stringify(s, null, 2) + '\n')
const excluded = (src, rel) => (src.exclude ?? []).some(x => x.endsWith('/') ? rel.startsWith(x) : rel === x)

function kindOf(rel) {
  if (/(^|\/)SKILL\.md$/.test(rel)) return 'entry'
  if (/(^|\/)tests\//.test(rel)) return 'test'
  if (/(^|\/)scripts\//.test(rel)) return 'rule'
  if (/(^|\/)references\//.test(rel)) return 'method'
  if (/(^|\/)corpus\//.test(rel)) return 'corpus'
  if (/(^|\/)(templates|模板)\//.test(rel)) return 'template'
  if (/(^|\/)(examples|案例)\//.test(rel)) return 'example'
  if (/(^|\/)(CHANGELOG|README|LICENSE)(\.md)?$/.test(rel) || /\.ya?ml$/.test(rel)) return 'meta'
  if (rel.endsWith('.md')) return 'method'
  return 'meta'
}

/** 头条方法登记表：从 methods.ts 读 METHOD_FILES（不依赖构建） */
async function toutiaoRegistry(src) {
  const text = await readFile(path.join(ROOT, src.registry.file), 'utf8')
  const block = text.slice(text.indexOf('METHOD_FILES'), text.indexOf('}', text.indexOf('METHOD_FILES')))
  const map = {}
  for (const m of block.matchAll(/'([^']+)':\s*'([^']+)'/g)) map[m[1]] = m[2]
  return map
}

function idFor(src, rel, registry) {
  if (src.kind === 'profile') return rel.endsWith('.md') ? rel.replace(/\.md$/, '') : undefined
  if (src.registry?.type === 'toutiao-methods') return Object.entries(registry).find(([, f]) => f === rel)?.[0]
  if (src.registry?.type === 'forge-tree') {
    if (!rel.endsWith('.md') || /(^|\/)(scripts|tests)\//.test(rel) || path.posix.basename(rel) === 'LICENSE') return undefined
    return rel.replace(/\.md$/, '')
  }
  return undefined
}

async function buildManifest() {
  const sources = await loadSources()
  const entries = []
  const summary = {}
  for (const src of sources.sources) {
    const sum = summary[src.id] = { title: src.title, mode: src.mode, kind: src.kind, version: src.version ?? null, files: 0, bytes: 0, loadable: 0, byKind: {} }
    if (src.kind === 'builtin') {
      const modPath = path.join(SCRIPT_ROOT, src.module)
      if (!existsSync(modPath)) throw new Error(`缺少 ${src.module}：先运行 npm run build`)
      const mod = await import(pathToFileURL(modPath).href)
      for (const a of mod.listMethodAssets()) {
        const body = mod.getMethodAsset(a.id).body
        const bytes = Buffer.byteLength(body)
        entries.push({ source: src.id, id: a.id, title: a.title, kind: 'builtin', origin: 'local', tool: src.tool, path: src.source, bytes, sha256: sha(body) })
        sum.files++; sum.bytes += bytes; sum.loadable++; sum.byKind.builtin = (sum.byKind.builtin ?? 0) + 1
      }
      continue
    }
    const registry = src.registry?.type === 'toutiao-methods' ? await toutiaoRegistry(src) : {}
    const dest = path.join(ROOT, src.dest)
    for (const rel of await walk(dest)) {
      if (excluded(src, rel)) continue
      const buf = await readFile(path.join(dest, rel))
      const id = idFor(src, rel, registry)
      const origin = src.kind === 'local' || src.kind === 'profile' || (src.local ?? []).includes(rel) ? 'local' : (src.patched ?? []).includes(rel) ? 'patched' : 'upstream'
      const kind = src.kind === 'profile' ? (rel === 'profile.json' ? 'meta' : rel.startsWith('corpus-') ? 'corpus' : /^templates?-/.test(rel) ? 'template' : /^examples-/.test(rel) ? 'example' : 'method') : kindOf(rel)
      entries.push({ source: src.id, ...(id ? { id, tool: src.tool } : {}), kind, origin, path: `${src.dest}/${rel}`, bytes: buf.length, sha256: sha(buf) })
      sum.files++; sum.bytes += buf.length; if (id) sum.loadable++
      sum.byKind[kind] = (sum.byKind[kind] ?? 0) + 1
    }
  }
  return { schemaVersion: 1, note: '由 scripts/assets.mjs manifest 生成，勿手改', sources: summary, entries }
}

async function writeManifest() {
  const m = await buildManifest()
  await writeFile(path.join(ROOT, 'assets/manifest.json'), JSON.stringify(m, null, 2) + '\n')
  return m
}

/** 一致性检查：返回问题列表（空 = 通过） */
async function check() {
  const problems = []
  const sources = await loadSources()
  const file = path.join(ROOT, 'assets/manifest.json')
  if (!existsSync(file)) return ['缺少 assets/manifest.json：运行 npm run assets -- manifest']
  const saved = JSON.parse(await readFile(file, 'utf8'))
  const now = await buildManifest()
  const key = (e) => `${e.source}|${e.path}|${e.id ?? ''}`
  const a = new Map(saved.entries.map(e => [key(e), e])), b = new Map(now.entries.map(e => [key(e), e]))
  for (const [k, e] of b) {
    const old = a.get(k)
    if (!old) problems.push(`清单里没有：${e.path}${e.id ? `（${e.id}）` : ''}`)
    else if (old.sha256 !== e.sha256) problems.push(`${e.origin === 'upstream' ? '上游原件被改动' : '内容变了'}：${e.path}${e.origin === 'upstream' ? '（有意修改请登记到 sources.json 的 patched，再重建清单）' : '（重建清单）'}`)
    else if (old.origin !== e.origin || old.kind !== e.kind) problems.push(`分类变了：${e.path}`)
  }
  for (const [k, e] of a) if (!b.has(k)) problems.push(`磁盘上已没有：${e.path}${e.id ? `（${e.id}）` : ''}`)
  for (const src of sources.sources) {
    if (src.kind !== 'upstream') continue
    const dest = path.join(ROOT, src.dest)
    for (const f of [...(src.local ?? []), ...(src.patched ?? [])]) if (!existsSync(path.join(dest, f))) problems.push(`${src.id} 登记的 ${f} 不存在`)
    if (src.versionFrom) {
      const txt = await readFile(path.join(dest, src.versionFrom.file), 'utf8').catch(() => '')
      const v = txt.match(new RegExp(src.versionFrom.pattern))?.[1]
      if (v !== src.version) problems.push(`${src.id}：sources.json 写 ${src.version}，原件里是 ${v ?? '（读不到）'}`)
    }
    for (const ref of src.versionRefs ?? []) {
      const txt = await readFile(path.join(ROOT, ref.file), 'utf8').catch(() => '')
      const vs = [...txt.matchAll(new RegExp(ref.pattern, 'g'))].map(m => m[1])
      if (!vs.length) problems.push(`${ref.file} 里找不到版本号（${ref.pattern}）`)
      for (const v of vs) if (v !== src.version) problems.push(`${ref.file} 写的是 ${src.id} ${v}，应为 ${src.version}`)
    }
    if (src.registry?.type === 'toutiao-methods') {
      const reg = await toutiaoRegistry(src)
      const files = new Set(Object.values(reg))
      for (const [id, f] of Object.entries(reg)) if (!existsSync(path.join(dest, f))) problems.push(`${src.registry.file} 登记的 ${id} → ${f} 不存在`)
      const all = await walk(dest)
      for (const rel of all) {
        const want = src.registry.files.includes(rel) || src.registry.dirs.some(d => rel.startsWith(d + '/'))
        if (want && !files.has(rel)) problems.push(`未登记（模型取不到）：${src.dest}/${rel} → 在 ${src.registry.file} 的 METHOD_FILES 加一行`)
      }
    }
  }
  return problems
}

/* ---------------- 导入上游新版 ---------------- */

// 没标 UTF-8 的 zip（Windows 常见）文件名按 cp437 读出来是乱码：还原成 UTF-8，不行再按 GBK
const UNZIP_PY = `
import sys, os, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as z:
    for info in z.infolist():
        name = info.filename
        if not (info.flag_bits & 0x800):
            raw = name.encode('cp437')
            for enc in ('utf-8', 'gbk'):
                try:
                    name = raw.decode(enc); break
                except UnicodeDecodeError:
                    pass
        target = os.path.realpath(os.path.join(out, name))
        if not target.startswith(os.path.realpath(out) + os.sep):
            continue
        if name.endswith('/'):
            os.makedirs(target, exist_ok=True); continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with z.open(info) as r, open(target, 'wb') as w:
            w.write(r.read())
`

async function extractZip(zip) {
  const out = await mkdtemp(path.join(tmpdir(), 'writer-assets-'))
  for (const py of [process.env.WRITER_PYTHON, 'python3', 'python', 'py'].filter(Boolean)) {
    try { execFileSync(py, [...(py === 'py' ? ['-3'] : []), '-c', UNZIP_PY, zip, out], { stdio: 'ignore' }); return out } catch { /* 换下一个 */ }
  }
  throw new Error('解不开 zip：需要 Python 3（配置的 python、python3、python 或 py -3）；也可以先手动解压，再传目录')
}

async function locate(base, src, depth = 0) {
  if (existsSync(path.join(base, src.marker)) && (path.basename(base) === src.upstreamRoot || depth === 0)) return base
  if (depth > 3) return undefined
  for (const e of await readdir(base, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue
    const hit = await locate(path.join(base, e.name), src, depth + 1)
    if (hit) return hit
  }
  return undefined
}

async function importSource(id, from) {
  const sources = await loadSources()
  const src = sources.sources.find(s => s.id === id)
  if (!src) throw new Error(`没有这个来源：${id}。可选：${sources.sources.filter(s => s.kind === 'upstream').map(s => s.id).join('、')}`)
  if (src.kind !== 'upstream') throw new Error(`${id} 是本项目自写资产，不从上游导入`)
  if (!from) throw new Error('缺少新版目录或 zip')
  let base = path.resolve(from)
  const st = await stat(base).catch(() => undefined)
  if (!st) throw new Error(`找不到：${from}`)
  let tmp
  if (st.isFile()) { tmp = await extractZip(base); base = tmp }
  try {
    const up = await locate(base, src)
    if (!up) throw new Error(`在 ${from} 里找不到 ${src.upstreamRoot}（应含 ${src.marker}）`)
    const vtxt = await readFile(path.join(up, src.versionFrom.file), 'utf8').catch(() => '')
    const newVersion = vtxt.match(new RegExp(src.versionFrom.pattern))?.[1] ?? 'unknown'
    const dest = path.join(ROOT, src.dest)
    const keep = new Set([...(src.local ?? [])])
    const patched = new Set(src.patched ?? [])
    const mine = (await walk(dest)).filter(r => !keep.has(r) && !excluded(src, r))
    const theirs = (await walk(up)).filter(r => !excluded(src, r))
    const added = [], changed = [], removed = [], conflicts = [], same = []
    for (const r of theirs) {
      if (keep.has(r)) { conflicts.push(`${r}（本项目文件，上游也有同名，保留本项目的）`); continue }
      if (!mine.includes(r)) { added.push(r); continue }
      const [x, y] = await Promise.all([readFile(path.join(dest, r)), readFile(path.join(up, r))])
      if (sha(x) === sha(y)) same.push(r)
      else if (patched.has(r)) conflicts.push(`${r}（本地有修改，上游也改了：需手工合并）`)
      else changed.push(r)
    }
    for (const r of mine) if (!theirs.includes(r)) (patched.has(r) ? conflicts.push(`${r}（本地有修改，上游已删除）`) : removed.push(r))
    const report = [
      `# 资产更新：${src.id} ${src.version} → ${newVersion}`,
      '', `- 来源：${from}`, `- 时间：${new Date().toISOString()}`, `- 方式：${APPLY ? '已应用' : '仅比对（加 --apply 才会写入）'}`,
      `- 新增 ${added.length}、修改 ${changed.length}、删除 ${removed.length}、未变 ${same.length}、需人工 ${conflicts.length}`,
      ...[['新增', added], ['修改', changed], ['删除', removed], ['需人工处理', conflicts]].flatMap(([t, l]) => l.length ? ['', `## ${t}`, ...l.map(x => `- ${x}`)] : []),
    ]
    if (APPLY) {
      for (const r of [...added, ...changed]) { await mkdir(path.dirname(path.join(dest, r)), { recursive: true }); await cp(path.join(up, r), path.join(dest, r)) }
      for (const r of removed) await rm(path.join(dest, r), { force: true })
      if (newVersion !== 'unknown' && newVersion !== src.version) {
        for (const ref of src.versionRefs ?? []) {
          const f = path.join(ROOT, ref.file)
          const txt = await readFile(f, 'utf8')
          await writeFile(f, txt.replace(new RegExp(ref.pattern, 'g'), (m, v) => m.replace(v, newVersion)))
        }
        src.version = newVersion
        await saveSources(sources)
      }
      await writeManifest()
      const left = await check()
      report.push('', '## 应用后检查', ...(left.length ? left.map(x => `- ${x}`) : ['- 通过']), '', '下一步：npm test（方法加载测试会逐份核对），再更新 CHANGELOG。')
      await mkdir(path.join(ROOT, 'assets/updates'), { recursive: true })
      await writeFile(path.join(ROOT, `assets/updates/${src.id}-${newVersion}.md`), report.join('\n') + '\n')
    }
    console.log(report.join('\n'))
    return { added, changed, removed, conflicts, same, newVersion }
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true })
  }
}

try {
  if (cmd === 'manifest') {
    const m = await writeManifest()
    for (const [id, s] of Object.entries(m.sources)) console.log(`${id}${s.version ? ' ' + s.version : ''}：${s.files} 份，可加载 ${s.loadable}，${Math.round(s.bytes / 1024)}KB`)
  } else if (cmd === 'check') {
    const p = await check()
    if (p.length) { console.error(`资产检查未通过（${p.length} 项）：\n` + p.map(x => '  - ' + x).join('\n')); process.exit(1) }
    console.log('资产检查通过：清单、登记、版本号与磁盘一致')
  } else if (cmd === 'import') {
    await importSource(rest[0], rest[1])
  } else {
    console.log('用法：node scripts/assets.mjs manifest | check | import <来源> <目录|zip> [--apply] [--root 目录]')
    process.exit(cmd ? 1 : 0)
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
