// 创作方法论配齐与加载：
//   1. 头条方法与语料、forge 三件套、引擎方法资产，和原件逐份对照，一份不缺；
//   2. 每一份都能经对应工具真实加载（源码构建与打好的插件包各跑一遍）；
//   3. 常驻规则、方法、工具说明里提到的工具名都真实存在（防止"让模型去调一个不存在的工具"）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { BUILD, ROOT, fakeHost, tempDir } from './helpers.mjs'

const TOUTIAO_SKILL = path.join(ROOT, 'packages/toutiao/skill')
const FORGE = path.join(ROOT, 'packages/fanqie/skill/forge')

async function files(dir, ext) {
  const out = []
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) { if (e.name !== 'scripts' && e.name !== 'tests' && e.name !== '__pycache__') await walk(p) }
      else if (e.name.endsWith(ext)) out.push(path.relative(dir, p).split(path.sep).join('/'))
    }
  }
  await walk(dir)
  return out.sort()
}

async function enableBoth(apply) {
  const host = fakeHost()
  apply(host.root.ctx, {})
  const cwd = await tempDir()
  const tt = host.agent('tt', cwd), fq = host.agent('fq', cwd)
  const call = (agent, n, a = {}) => host.call(agent, n, a)
  const a = await call(tt, 'writer_enable', { mode: 'toutiao' })
  const b = await call(fq, 'writer_enable', { mode: 'fanqie' })
  assert.equal(a.ok, true, JSON.stringify(a))
  assert.equal(b.ok, true, JSON.stringify(b))
  return { host, tt, fq, call, receipts: [a, b] }
}

async function loadEverything(apply, label) {
  const { tt, fq, call, receipts } = await enableBoth(apply)
  const loaded = { toutiao: 0, forge: 0, engine: 0 }
  const texts = []

  // 头条：toutiao_method_get 的每个 id
  const ttTool = tt.scope.tools.get('toutiao_method_get')
  const ids = ttTool.parameters?.properties?.id?.enum
  assert.ok(Array.isArray(ids) && ids.length >= 30, `${label}: 头条方法 id 列表`)
  for (const id of ids) {
    const r = await call(tt, 'toutiao_method_get', { id })
    assert.equal(r.ok, true, `${label}: toutiao_method_get ${id} → ${JSON.stringify(r).slice(0, 200)}`)
    assert.ok(String(r.text ?? '').trim().length > 50, `${label}: ${id} 内容为空`)
    loaded.toutiao++
  }

  // forge：fanqie_forge_get 目录与每一份
  const idx = await call(fq, 'fanqie_forge_get', {})
  assert.equal(idx.ok, true, JSON.stringify(idx).slice(0, 300))
  idx.methods = (await call(fq, 'fanqie_forge_get', { id: 'list' })).methods
  for (const key of Object.keys(idx.key_methods)) assert.ok(idx.methods.includes(key), `${label}: 常用入口 ${key} 不存在`)
  for (const id of idx.methods) {
    const r = await call(fq, 'fanqie_forge_get', { id })
    assert.equal(r.ok, true, `${label}: fanqie_forge_get ${id}`)
    assert.match(r.text, /写作 Agent 适配/)
    loaded.forge++
  }
  texts.push((await call(fq, 'fanqie_forge_get', { id: idx.methods[0] })).text.split('\n').slice(0, 12).join('\n'))

  // 引擎方法资产：fanqie_method_list / fanqie_method_get
  const list = await call(fq, 'fanqie_method_list', {})
  const listText = typeof list === 'string' ? list : JSON.stringify(list)
  const engineIds = [...listText.matchAll(/^- \*?\*?`?([a-z_]+)`?/gm)].map(m => m[1])
  assert.ok(engineIds.length >= 12, `${label}: 引擎方法资产目录 ${listText.slice(0, 200)}`)
  for (const id of engineIds) {
    const r = await call(fq, 'fanqie_method_get', { ids: id })
    const text = typeof r === 'string' ? r : JSON.stringify(r)
    assert.match(text, new RegExp(`方法资产 · ${id} · `), `${label}: fanqie_method_get ${id}`)
    assert.ok(text.length > 80, `${label}: ${id} 内容为空`)
    texts.push(text)
    loaded.engine++
  }
  texts.push(listText)
  return { tt, fq, call, loaded, texts, receipts, engineIds, forgeIds: idx.methods, toutiaoIds: ids }
}

const { apply } = await import(path.join(BUILD, 'app/src/index.js'))

test('原件对照：头条方法与语料、forge 三件套都完整在包里，并全部登记为可加载', async () => {
  const { METHOD_FILES } = await import(path.join(BUILD, 'toutiao/src/methods.js'))
  const docs = [...await files(TOUTIAO_SKILL, '.md'), ...await files(TOUTIAO_SKILL, '.json')].filter(f => f !== 'CHANGELOG.md')
  const registered = new Set(Object.values(METHOD_FILES))
  assert.deepEqual(docs.filter(f => !registered.has(f)), [], '头条 skill 里没有登记的方法文件')
  for (const f of registered) assert.ok(existsSync(path.join(TOUTIAO_SKILL, f)), `登记了不存在的文件 ${f}`)
  const { listMethods } = await import(path.join(BUILD, 'fanqie/src/forge.js'))
  const forgeDocs = (await files(FORGE, '.md')).map(f => f.replace(/\.md$/, ''))
  assert.deepEqual(await listMethods(), forgeDocs)
  for (const pkg of ['inspiration-forge', 'inspiration-forge-library', 'novel-writer']) assert.ok(forgeDocs.includes(`${pkg}/SKILL`), `${pkg} 缺 SKILL`)
  // 原文之间的 Markdown 链接，以及原文里只写相对路径的引用，都能经 getFanqieMethod 取到
  const { getFanqieMethod } = await import(path.join(BUILD, 'fanqie/src/forge.js'))
  const { readFile } = await import('node:fs/promises')
  const broken = []
  for (const id of forgeDocs) {
    const text = await readFile(path.join(FORGE, id + '.md'), 'utf8')
    for (const m of text.matchAll(/\]\(([^)#\s]+\.md)\)/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(id), decodeURIComponent(m[1]))).replace(/\.md$/, '')
      if (!forgeDocs.includes(target)) broken.push(`${id} → ${m[1]}`)
    }
  }
  assert.deepEqual(broken, [], '方法原文里的链接指向不存在的文件')
  assert.equal((await getFanqieMethod('references/editor_method.md')).id, 'novel-writer/references/editor_method')
  assert.equal((await getFanqieMethod('./资产/幕转章纲')).id, 'inspiration-forge/资产/幕转章纲')
})

test('源码构建：三套方法论每一份都能经工具加载；提到的工具名都存在', async () => {
  const r = await loadEverything(apply, '源码')
  assert.ok(r.loaded.toutiao >= 30 && r.loaded.forge >= 100 && r.loaded.engine >= 12, JSON.stringify(r.loaded))
  assert.ok(r.engineIds.includes('edit'), '编辑过稿方法可加载')

  // 工具名引用检查
  const names = new Set(['writer_enable', ...r.tt.scope.tools.keys(), ...r.fq.scope.tools.keys()])
  const sources = [
    ...r.tt.scope.sections.map(s => s.text()), ...r.fq.scope.sections.map(s => s.text()),
    ...[...r.tt.scope.tools.values(), ...r.fq.scope.tools.values()].map(t => t.description ?? ''),
    ...r.texts, JSON.stringify(r.receipts),
  ]
  const productMap = await r.call(r.fq, 'fanqie_product_map', {})
  sources.push(typeof productMap === 'string' ? productMap : JSON.stringify(productMap))
  const missing = new Set()
  for (const text of sources) {
    for (const m of text.matchAll(/\b((?:fanqie|toutiao)_[a-z][a-z_]*[a-z])\b/g)) if (!names.has(m[1]) && !/_bridge$/.test(m[1])) missing.add(m[1])
  }
  assert.deepEqual([...missing], [], '这些工具名被提到却不存在')

  // 规则与说明里点名的方法 id 都能取到
  const all = sources.join('\n')
  const badTt = [...all.matchAll(/\b(s[1-7]-[a-z]+|corpus-[a-z\u4e00-\u9fa5-]+|template-[a-z]+)\b/g)].map(m => m[1]).filter(id => !r.toutiaoIds.includes(id))
  assert.deepEqual([...new Set(badTt)], [], '头条方法 id 不存在')
  const badForge = [...all.matchAll(/\b((?:inspiration-forge-library|inspiration-forge|novel-writer)\/[^\s，。、；：）)'"`*]+)/g)].map(m => m[1].replace(/\.md$/, '')).filter(id => !r.forgeIds.includes(id))
  assert.deepEqual([...new Set(badForge)], [], 'forge 方法 id 不存在')
  const badEngine = [...all.matchAll(/fanqie_method_get[^\n]{0,12}?ids?=([a-z_]+)/g)].map(m => m[1]).filter(id => !r.engineIds.includes(id))
  assert.deepEqual([...new Set(badEngine)], [], '引擎方法资产 id 不存在')
})

const BUNDLE = path.join(ROOT, 'bundle/dist/index.js')
test('打好的插件包：从包内路径加载三套方法论', { skip: !existsSync(BUNDLE) && '先 npm run bundle' }, async () => {
  const mod = await import(BUNDLE + '?t=' + Date.now())
  const r = await loadEverything(mod.apply, '插件包')
  assert.ok(r.loaded.toutiao >= 30 && r.loaded.forge >= 100 && r.loaded.engine >= 12, JSON.stringify(r.loaded))
})
