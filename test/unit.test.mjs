import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { BUILD, FIX, tempDir, importModule } from './helpers.mjs'

const { resolveInside, serialize, atomicWrite, readJson } = await importModule(path.join(BUILD, 'core/src/fsx.js'))
const { parseContract, locatePython, runScript } = await importModule(path.join(BUILD, 'core/src/runner.js'))
const { createGateEngine } = await importModule(path.join(BUILD, 'core/src/gates.js'))
const { checkCard } = await importModule(path.join(BUILD, 'toutiao/src/card.js'))
const { ArticleStore, canTransition } = await importModule(path.join(BUILD, 'toutiao/src/store.js'))
const { getMethod, METHOD_FILES } = await importModule(path.join(BUILD, 'toutiao/src/methods.js'))
const { TOUTIAO_BRIEF } = await importModule(path.join(BUILD, 'toutiao/src/brief.js'))

test('resolveInside 拒绝越界', () => {
  assert.equal(resolveInside('/a/b', 'c'), path.resolve('/a/b/c'))
  assert.throws(() => resolveInside('/a/b', '../c'), /越界/)
  assert.throws(() => resolveInside('/a/b', '/etc/passwd'), /越界/)
})

test('serialize 串行化同 key 的读改写', async () => {
  const dir = await tempDir()
  const f = path.join(dir, 'n.json')
  await atomicWrite(f, '{"n":0}')
  await Promise.all(Array.from({ length: 30 }, () => serialize(f, async () => {
    const v = await readJson(f); await new Promise(r => setTimeout(r, 1)); await atomicWrite(f, JSON.stringify({ n: v.n + 1 }))
  })))
  assert.equal((await readJson(f)).n, 30)
})

test('脚本契约：非 JSON、缺字段、非零退出码都判失败', () => {
  assert.throws(() => parseContract('综合 90 分', '', 0), /不是合法 JSON/)
  assert.throws(() => parseContract('{"ok":true}', '', 0), /契约字段/)
  assert.throws(() => parseContract('{"tool":"qa","rules_version":"4","ok":true}', 'boom', 1), /退出码 1/)
  assert.equal(parseContract('{"tool":"qa","rules_version":"4","ok":true}', '', 0).ok, true)
})

test('运行器：超时', async () => {
  const py = await locatePython()
  const dir = await tempDir()
  const f = path.join(dir, 's.py')
  await atomicWrite(f, 'import time\ntime.sleep(5)\n')
  await assert.rejects(runScript(py, f, [], { timeoutMs: 300 }), /超时/)
})

test('门禁引擎：deny 优先；ask 记录 token，只能消费一次；锁定规则不能关', async () => {
  const rules = [
    { id: 'a', tool: 't', locked: true, description: '', check: (a) => a.x === 1 ? { kind: 'deny', reason: 'no' } : undefined },
    { id: 'b', tool: 't', locked: false, description: '', check: () => ({ kind: 'ask', reason: 'sure?' }) },
  ]
  const e = createGateEngine(rules, { disabled: ['a'] })
  assert.equal(e.isActive('a'), true, '锁定规则不能被关闭')
  const tok = Symbol()
  assert.equal((await e.evaluate({ name: 't', arguments: { x: 1 }, token: tok })).kind, 'deny')
  const d = await e.evaluate({ name: 't', arguments: {}, token: tok })
  assert.equal(d.kind, 'ask')
  assert.equal(e.consumeConfirmation({ token: tok }, 'b'), true)
  assert.equal(e.consumeConfirmation({ token: tok }, 'b'), false)
  assert.equal(await e.evaluate({ name: 'other', arguments: {} }), undefined)
  const e2 = createGateEngine(rules, { disabled: ['b'] })
  assert.equal(e2.isActive('b'), false)
  const boom = createGateEngine([{ id: 'c', tool: 't', locked: true, description: '', check: () => { throw new Error('x') } }])
  assert.equal((await boom.evaluate({ name: 't', arguments: {} })).kind, 'deny', '门禁出错按拒绝处理')
})

test('立项卡预检：样例卡通过，模板卡报占位，故事线缺字段报错', async () => {
  const card = JSON.parse(await readFile(path.join(FIX, 'story_long_card.json'), 'utf8'))
  assert.deepEqual(checkCard(card).filter(i => i.level === 'fail'), [])
  const bad = { ...card, 母题: '', 主标题: '一'.repeat(35), 备注: '{name}' }
  const issues = checkCard(bad).map(i => i.field)
  assert.ok(issues.includes('母题'))
  assert.ok(issues.includes('主标题'))
  assert.ok(issues.includes('备注'))
})

test('状态机', () => {
  assert.equal(canTransition('初稿待改', '已验收'), false)
  assert.equal(canTransition('待验收', '已验收'), true)
  assert.equal(canTransition('已验收', '已交稿'), true)
  assert.equal(canTransition('已交稿', '初稿待改'), false)
})

test('稿件只增不改，哈希记录', async () => {
  const s = new ArticleStore(await tempDir())
  const m = await s.create('a', { date: '2026-10-28' })
  await s.stageDraft(m.id, '# t\n一', 'writer', '')
  const m2 = await s.stageDraft(m.id, '# t\n二', 'editor', '')
  assert.equal(m2.current_rev, 2)
  assert.equal(await s.readDraft(m.id, 1), '# t\n一')
  assert.notEqual(m2.drafts[0].sha256, m2.drafts[1].sha256)
  await assert.rejects(s.create('a', { date: '2026-10-28' }), /已存在/)
})

test('方法文件全部可取，总则不超 2k 字且不含 shell 命令', async () => {
  for (const id of Object.keys(METHOD_FILES)) assert.ok((await getMethod(id)).text.length > 100, id)
  assert.ok([...TOUTIAO_BRIEF].length < 2000, `brief=${[...TOUTIAO_BRIEF].length}`)
  assert.doesNotMatch(TOUTIAO_BRIEF, /python3|scripts\//)
})
