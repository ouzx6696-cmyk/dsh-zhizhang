// 方法方案：默认（精炼版）/ 原版 / 用户方案一、二…
//   1. 默认方案文件齐全、标题与目录一致、长篇别名覆盖全部原版 id、只提真实工具名、母题库标题与规则名单一致；
//   2. 工具：读默认、强制读原版、回落原版、建用户方案（导入文件夹）、覆盖、切换、恢复、改名，第二个方案以原版为底；
//   3. 写作台接口：列表、详情、全文（附底稿）、新建、保存、切换、删除须确认；配置固定方案时不许切换。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BUILD, ROOT, fakeHost, tempDir } from './helpers.mjs'

const TT = path.join(ROOT, 'packages/toutiao/profiles/default')
const FQ = path.join(ROOT, 'packages/fanqie/profiles/default')

async function toolNames() {
  const txt = await readFile(path.join(ROOT, 'packages/toutiao/src/tools.ts'), 'utf8') + await readFile(path.join(ROOT, 'packages/fanqie/src/tools.ts'), 'utf8')
  const names = new Set(['writer_enable', 'toutiao_profile', 'fanqie_profile'])
  for (const m of txt.matchAll(/name: '((?:toutiao|fanqie)_[a-z_]+)'/g)) names.add(m[1])
  const walk = async (d) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.name.endsWith('.ts')) for (const m of (await readFile(p, 'utf8')).matchAll(/name: "(fanqie_[a-z_]+)"/g)) names.add(m[1])
    }
  }
  await walk(path.join(ROOT, 'packages/fanqie/src/engine'))
  return names
}

test('默认方案：文件齐全、目录一致、别名完整、工具名真实', async () => {
  const names = await toolNames()
  for (const [dir, mode] of [[TT, 'toutiao'], [FQ, 'fanqie']]) {
    const idx = JSON.parse(await readFile(path.join(dir, 'profile.json'), 'utf8'))
    assert.equal(idx.mode, mode)
    const files = (await readdir(dir)).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, '')).sort()
    const listed = idx.methods.filter(m => !m.fallback).map(m => m.id).sort()
    assert.deepEqual(files, listed, `${mode}: profile.json 与文件一致`)
    for (const id of files) {
      const text = await readFile(path.join(dir, id + '.md'), 'utf8')
      assert.equal((text.match(/^# .+$/gm) ?? []).length >= 1, true, `${mode}/${id} 有 # 标题`)
      assert.ok(text.length > 800, `${mode}/${id} 不能是空壳`)
      assert.ok(!/[「」]/.test(text), `${mode}/${id} 不用「」`)
      assert.ok(!/\b(python3?|init_project\.py|archive_draft\.py|qa_check\.py)\b/.test(text), `${mode}/${id} 不残留脚本命令`)
      for (const m of text.matchAll(/\b((?:toutiao|fanqie)_[a-z]+(?:_[a-z]+)+)\b/g)) {
        assert.ok(names.has(m[1]), `${mode}/${id} 提到的工具不存在：${m[1]}`)
      }
    }
  }
  const tt = JSON.parse(await readFile(path.join(TT, 'profile.json'), 'utf8'))
  const { METHOD_FILES } = await import(path.join(BUILD, 'toutiao/src/methods.js'))
  assert.deepEqual(tt.methods.map(m => m.id).sort(), Object.keys(METHOD_FILES).sort(), '头条默认方案覆盖全部 30 个 id')
  // 母题库：二级标题与规则名单一致（质检按名单核对母题）
  const rules = await readFile(path.join(ROOT, 'packages/toutiao/skill/scripts/rules.py'), 'utf8')
  const motifs = [...(rules.match(/MOTIFS\s*=\s*[[(]([\s\S]*?)[\])]/)?.[1] ?? '').matchAll(/["']([^"']+)["']/g)].map(m => m[1])
  const heads = [...(await readFile(path.join(TT, 'corpus-story-motifs.md'), 'utf8')).matchAll(/^## (.+)$/gm)].map(m => m[1].trim())
  assert.ok(motifs.length > 3)
  assert.deepEqual(heads, motifs)
  // 长篇：每个原版 forge id 都有归宿
  const fq = JSON.parse(await readFile(path.join(FQ, 'profile.json'), 'utf8'))
  const { listMethods } = await import(path.join(BUILD, 'fanqie/src/forge.js'))
  const forge = await listMethods()
  assert.deepEqual(forge.filter(id => !fq.aliases[id]), [])
  const ids = new Set(fq.methods.map(m => m.id))
  assert.ok(Object.values(fq.aliases).every(v => ids.has(v)))
})

async function enable(config = {}) {
  const { apply } = await import(path.join(BUILD, 'app/src/index.js'))
  const host = fakeHost()
  apply(host.root.ctx, config)
  const cwd = await tempDir()
  const tt = host.agent('tt', cwd), fq = host.agent('fq', cwd)
  await host.call(tt, 'writer_enable', { mode: 'toutiao' })
  await host.call(fq, 'writer_enable', { mode: 'fanqie' })
  return { host, cwd, tt, fq, call: (a, n, x = {}) => host.call(a, n, x) }
}

test('工具：默认 → 原版回落 → 用户方案一（导入、覆盖、切换、恢复）→ 用户方案二以原版为底', async () => {
  process.env.WRITER_PROFILES_DIR = await tempDir('writer-profiles-')
  try {
    const { cwd, tt, fq, call } = await enable()
    let r = await call(tt, 'toutiao_method_get', { id: 's3-headline' })
    assert.equal(r.from, 'default'); assert.equal(r.profile_name, '默认')
    assert.equal((await call(tt, 'toutiao_method_get', { id: '原版:s3-headline' })).from, 'original')
    assert.equal((await call(tt, 'toutiao_method_get', { id: 'template-card' })).from, 'original', '默认没有的回落原版')
    const list0 = await call(tt, 'toutiao_profile', { action: 'list' })
    assert.deepEqual(list0.profiles.map(p => p.name), ['默认', '原版'])
    assert.equal(list0.active, 'default')

    await mkdir(path.join(cwd, '我的头条/语料'), { recursive: true })
    await writeFile(path.join(cwd, '我的头条/s3-headline.md'), '# 我的标题法\n先写钱，再写人。\n')
    await writeFile(path.join(cwd, '我的头条/语料/养老.md'), '# 养老语料\n退休金到账那天。\n')
    const made = await call(tt, 'toutiao_profile', { action: 'create', from_dir: '我的头条', note: '自己的标题法' })
    assert.equal(made.profile.name, '用户方案一')
    assert.deepEqual(made.imported.sort(), ['s3-headline', '语料/养老'])
    // 未切换前仍是默认
    assert.equal((await call(tt, 'toutiao_method_get', { id: 's3-headline' })).from, 'default')
    await call(tt, 'toutiao_profile', { action: 'use', profile: '用户方案一' })
    r = await call(tt, 'toutiao_method_get', { id: 's3-headline' })
    assert.equal(r.from, 'user'); assert.match(r.text, /先写钱/)
    assert.equal((await call(tt, 'toutiao_method_get', { id: 's4-common' })).from, 'default', '没覆盖的用底稿')
    assert.match((await call(tt, 'toutiao_method_get', { id: '语料/养老' })).text, /退休金/)
    const listed = await call(tt, 'toutiao_method_get', { id: 'list' })
    assert.equal(listed.profile, '用户方案一')
    assert.ok(listed.methods.some(m => m.id === '语料/养老' && m.from === 'user'))
    const saved = await call(tt, 'toutiao_profile', { action: 'save', profile: '用户方案一', method: 's6-qa', text: '# 质检\n按工具来。\n' })
    assert.equal(saved.id, 's6-qa')
    assert.equal((await call(tt, 'toutiao_profile', { action: 'show' })).methods.find(m => m.id === 's6-qa').overridden, true)
    await call(tt, 'toutiao_profile', { action: 'reset', profile: 'user-1', method: 's3-headline' })
    assert.equal((await call(tt, 'toutiao_method_get', { id: 's3-headline' })).from, 'default')
    await call(tt, 'toutiao_profile', { action: 'rename', profile: 'user-1', name: '我的头条方案' })
    assert.equal((await call(tt, 'toutiao_profile', { action: 'list' })).profiles[2].name, '我的头条方案')
    // 内置方案不能改；方法 id 不能越级
    assert.equal((await call(tt, 'toutiao_profile', { action: 'save', profile: '默认', method: 's3-headline', text: 'x' })).code, 'CONFLICT')
    assert.equal((await call(tt, 'toutiao_profile', { action: 'save', profile: 'user-1', method: '../x', text: 'x' })).code, 'INVALID_ARGS')
    const second = await call(tt, 'toutiao_profile', { action: 'create', base: '原版' })
    assert.equal(second.profile.name, '用户方案二'); assert.equal(second.profile.base, 'original')
    await call(tt, 'toutiao_profile', { action: 'use', profile: '用户方案二' })
    assert.equal((await call(tt, 'toutiao_method_get', { id: 's3-headline' })).from, 'original')

    // 长篇：两个模式各自独立；原版 forge id 在默认方案下对到同类方法
    r = await call(fq, 'fanqie_forge_get', { id: 'novel-writer/references/editor_method' })
    assert.equal(r.from, 'default'); assert.equal(r.id, 'edit')
    assert.equal((await call(fq, 'fanqie_forge_get', { id: 'references/writing' })).id, 'write-chapter')
    const orig = await call(fq, 'fanqie_forge_get', { id: '原版:novel-writer/references/editor_method' })
    assert.equal(orig.from, 'original'); assert.match(orig.text, /写作 Agent 适配/)
    const idx = await call(fq, 'fanqie_forge_get', {})
    assert.equal(idx.profile, '默认'); assert.ok(idx.key_methods.edit)
    await call(fq, 'fanqie_profile', { action: 'use', profile: '原版' })
    assert.ok((await call(fq, 'fanqie_forge_get', {})).key_methods['novel-writer/SKILL'])
    assert.equal((await call(fq, 'fanqie_forge_get', { id: 'novel-writer/references/editor_method' })).from, 'original')
    // 编辑子代理看不到方案管理工具
    const { host } = await enable()
    const ed = host.agent('ed', cwd)
    await host.call(ed, 'writer_enable', { mode: 'toutiao', role: 'editor' })
    assert.ok(!ed.scope.tools.has('toutiao_profile') && ed.scope.tools.has('toutiao_method_get'))
  } finally { delete process.env.WRITER_PROFILES_DIR }
})

test('写作台接口：方案列表、详情、全文、新建、保存、切换、删除；配置固定方案', async () => {
  process.env.WRITER_PROFILES_DIR = await tempDir('writer-profiles-')
  const routes = new Map()
  const services = { webServer: { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } } }
  const { apply } = await import(path.join(BUILD, 'app/src/index.js'))
  const host = fakeHost({ services })
  apply(host.root.ctx, { fanqie: { profile: '原版' } })
  const server = createServer((req, res) => {
    const h = routes.get(new URL(req.url, 'http://x').pathname.replace(/\/+$/, ''))
    if (!h) { res.writeHead(404); return res.end('{}') }
    return h(req, res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const api = `http://127.0.0.1:${server.address().port}/api/writer`
  const get = async (p) => (await fetch(api + p)).json()
  const post = async (p, body) => { const r = await fetch(api + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) } }
  try {
    let l = await get('/toutiao/profiles')
    assert.equal(l.ok, true); assert.equal(l.active, 'default'); assert.equal(l.profiles[0].methods, 30)
    const d = await get('/toutiao/profiles/detail?profile=default')
    assert.equal(d.methods.length, 30); assert.ok(d.methods.find(m => m.id === 's3-headline').title)
    const c = await post('/toutiao/profiles/create', { files: [{ id: 's3-headline.md', text: '# 标题\n我的。\n' }, { id: '新方法', text: '# 新\n内容\n' }] })
    assert.equal(c.profile.name, '用户方案一')
    const m = await get('/toutiao/profiles/method?profile=user-1&id=s3-headline')
    assert.equal(m.method.from, 'user'); assert.ok(m.base_text.length > 500, '覆盖时附底稿')
    const det = await get('/toutiao/profiles/detail?profile=user-1')
    assert.equal(det.methods.find(x => x.id === '新方法').added, true)
    assert.equal(det.profile.overrides, 2)
    assert.equal((await post('/toutiao/profiles/save', { profile: 'user-1', id: 's5-editing', text: '# 红笔\n' })).ok, true)
    assert.equal((await post('/toutiao/profiles/use', { profile: 'user-1' })).ok, true)
    assert.equal((await get('/toutiao/profiles')).active, 'user-1')
    assert.equal((await post('/toutiao/profiles/delete', { profile: 'user-1' })).status, 400, '删除须确认')
    const del = await post('/toutiao/profiles/delete', { profile: 'user-1', confirm: true })
    assert.equal(del.was_active, true)
    assert.equal((await get('/toutiao/profiles')).active, 'default', '删掉当前方案后回到默认')
    // 长篇在配置里固定为原版
    l = await get('/fanqie/profiles')
    assert.equal(l.active, 'original'); assert.equal(l.pinned, true)
    assert.equal((await post('/fanqie/profiles/use', { profile: 'default' })).status, 409)
    assert.equal((await get('/fanqie/profiles/method?profile=default&id=edit')).method.from, 'default')
    assert.equal((await post('/fanqie/profiles/save', { profile: 'default', id: 'edit', text: 'x' })).status, 409, '内置方案只读')
  } finally {
    server.close()
    delete process.env.WRITER_PROFILES_DIR
  }
})
