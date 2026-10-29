// 头条 S2→S7 全流程（真实 Python 规则脚本 + 假宿主门禁瀑布）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { BUILD, FIX, fakeHost, tempDir } from './helpers.mjs'

const { mountToutiao } = await import(path.join(BUILD, 'toutiao/src/index.js'))
const { apply } = await import(path.join(BUILD, 'app/src/index.js'))
const { adopt, __panelTesting } = await import(path.join(BUILD, 'toutiao/src/panel.js'))
const { STOP_LINE } = await import(path.join(BUILD, 'toutiao/src/store.js'))

const STORY = await readFile(path.join(FIX, 'story_long_good.md'), 'utf8')
const CARD = JSON.parse(await readFile(path.join(FIX, 'story_long_card.json'), 'utf8'))
const LONG = await readFile(path.join(FIX, 'long_good.md'), 'utf8')
const BAD = await readFile(path.join(FIX, 'bad.md'), 'utf8')
const TEMPLATE = JSON.parse(await readFile(path.join(FIX, '..', '..', 'templates', 'brief.json'), 'utf8'))
const _d = new Date()
const TODAY = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`

async function setup(opts) {
  const cwd = await tempDir()
  process.env.DSH_HOME = await tempDir('dshhome-')
  const host = fakeHost(opts)
  apply(host.root.ctx, {})
  const agent = host.agent('s1', cwd)
  const en = await host.call(agent, 'toutiao_enable')
  assert.equal(en.ok, true)
  return { host, agent, cwd, call: (n, a) => host.call(agent, n, a) }
}

function deliveryMd(title, draft) {
  return `# 交稿单 · ${title}\n\n- **当前状态**：已验收\n\n## 一、标题矩阵\n- 主推：${title}\n\n## 三、终稿正文\n${draft}\n`
}

test('启用：只挂一个触发工具，启用后按会话挂载工具、总则、门禁', async () => {
  const { host, agent } = await setup()
  assert.deepEqual([...host.root.tools.keys()].sort(), ['fanqie_enable', 'toutiao_enable', 'zhizhang_enable'])
  assert.ok(agent.scope.tools.size >= 18, `tools=${agent.scope.tools.size}`)
  assert.equal(agent.scope.sections.length, 1)
  assert.match(agent.scope.sections[0].text(), /AI 到此止步/)
  assert.equal(agent.scope.pre.length, 1)
  const again = await host.call(agent, 'toutiao_enable')
  assert.equal(again.already_enabled, true)
  assert.equal(agent.scope.tools.size >= 18, true)
})

test('全流程：故事线长图文 立项→标题→成稿→质检→验收→交稿单→台账→作者采用', async () => {
  const { host, call, cwd } = await setup()
  const c = await call('toutiao_article_create', { slug: 'jingwei', line: '故事线', genre: '长图文' })
  assert.equal(c.ok, true, JSON.stringify(c))
  const id = c.article.id
  assert.equal(id, `${TODAY}-jingwei`)
  assert.equal(c.root, path.join(cwd, 'outputs', 'toutiao'))

  const tpl = await call('toutiao_card_set', { id, card: TEMPLATE })
  assert.equal(tpl.ready, false, '模板卡应报占位符')
  assert.ok(tpl.issues.some(i => /占位/.test(i.message)))

  const cs = await call('toutiao_card_set', { id, card: CARD })
  assert.equal(cs.ready, true, JSON.stringify(cs.issues))

  const tooLong = await call('toutiao_headline_set', { id, main: CARD['主标题'], alts: ['一'.repeat(35)] })
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.code, 'INVALID_ARGS')
  const hs = await call('toutiao_headline_set', { id, main: CARD['主标题'], alts: ['备一', '备二', '备三', '备四'] })
  assert.equal(hs.ok, true, JSON.stringify(hs))

  const d = await call('toutiao_draft_stage', { id, text: STORY, role: 'writer' })
  assert.equal(d.rev, 1)
  assert.equal((await call('toutiao_status', { id, to: '待验收' })).ok, true)

  const early = await call('toutiao_status', { id, to: '已验收' })
  assert.equal(early.denied, true, '没质检就验收应被门禁拒绝')
  assert.match(early.reason, /toutiao\.accept_requires_qa/)

  const qa = await call('toutiao_qa_check', { id })
  assert.equal(qa.ok, true, JSON.stringify(qa))
  assert.equal(qa.pass, true, JSON.stringify(qa.fails))
  assert.ok(qa.score >= 84)
  assert.equal(qa.rules_version, '4.0.0')

  const acc = await call('toutiao_status', { id, to: '已验收' })
  assert.equal(acc.ok, true, JSON.stringify(acc))
  assert.equal(acc.article.status, '已验收')

  const badDelivery = await call('toutiao_delivery_save', { id, markdown: `# 交稿单 · ${CARD['主标题']}\n正文略` })
  assert.equal(badDelivery.code, 'INVALID_ARGS')
  const ds = await call('toutiao_delivery_save', { id, markdown: deliveryMd(CARD['主标题'], STORY) + '\n> ——AI 到此止步。随便写的' })
  assert.equal(ds.ok, true, JSON.stringify(ds))
  const saved = await readFile(ds.path, 'utf8')
  assert.ok(saved.trimEnd().endsWith(STOP_LINE), '末句必须是固定止步句')
  assert.equal(saved.split('AI 到此止步').length, 2, '止步句只出现一次')

  const led = await call('toutiao_ledger_add', { id })
  assert.equal(led.ok, true, JSON.stringify(led))
  assert.equal(led.row['状态'], '已验收')
  assert.equal((await call('toutiao_ledger_add', { id })).code, 'CONFLICT')

  host.approve = 'rejected'
  const rej = await call('toutiao_status', { id, to: '已交稿' })
  assert.equal(rej.denied, true)
  assert.equal(host.approvals.at(-1).name, 'toutiao_status')

  host.approve = 'allowed-once'
  const done = await call('toutiao_status', { id, to: '已交稿' })
  assert.equal(done.ok, true, JSON.stringify(done))
  assert.equal(done.article.status, '已交稿')
  assert.equal(done.ledger.synced, true)
  const shown = await call('toutiao_ledger_show', { last: 5 })
  assert.equal(shown.rows.at(-1)['状态'], '已交稿')

  const after = await call('toutiao_draft_stage', { id, text: STORY })
  assert.equal(after.code, 'CONFLICT', '已交稿不能再改')
})

test('改稿或改立项卡都会让旧质检作废', async () => {
  const { call } = await setup()
  const id = (await call('toutiao_article_create', { slug: 'inv' })).article.id
  await call('toutiao_card_set', { id, card: CARD })
  await call('toutiao_draft_stage', { id, text: STORY })
  await call('toutiao_status', { id, to: '待验收' })
  assert.equal((await call('toutiao_qa_check', { id })).pass, true)
  await call('toutiao_card_patch', { id, patch: { 情绪: '怅然' } })
  const r = await call('toutiao_status', { id, to: '已验收' })
  assert.equal(r.denied, true)
  assert.match(r.reason, /立项卡在质检后改过/)

  assert.equal((await call('toutiao_qa_check', { id })).pass, true)
  await call('toutiao_draft_stage', { id, text: STORY + '\n' })
  const st = await call('toutiao_article_get', { id })
  assert.equal(st.article.status, '初稿待改', '新稿回到初稿待改')
  await call('toutiao_status', { id, to: '待验收' })
  const r2 = await call('toutiao_status', { id, to: '已验收' })
  assert.equal(r2.denied, true)
  assert.match(r2.reason, /还没跑质检/)
})

test('打回超过两轮需作者同意', async () => {
  const { host, call } = await setup()
  const id = (await call('toutiao_article_create', { slug: 'rounds' })).article.id
  await call('toutiao_draft_stage', { id, text: BAD })
  await call('toutiao_status', { id, to: '待验收' })
  const qa = await call('toutiao_qa_check', { id, mode: 'short' })
  assert.equal(qa.pass, false, 'AI 腔稿应打回')
  for (let i = 0; i < 2; i++) {
    assert.equal((await call('toutiao_status', { id, to: '验收退回' })).ok, true)
    await call('toutiao_status', { id, to: '待验收' })
  }
  host.approve = 'rejected'
  const third = await call('toutiao_status', { id, to: '验收退回' })
  assert.equal(third.denied, true)
  assert.match(host.approvals.at(-1).reason, /已打回 2 轮/)
  host.approve = 'allowed-once'
  const ok3 = await call('toutiao_status', { id, to: '验收退回' })
  assert.equal(ok3.ok, true)
  assert.equal(ok3.article.return_rounds, 3)
})

test('门禁未接上时，工具自身仍拒绝未经作者确认的“已交稿”', async () => {
  const cwd = await tempDir()
  const tools = new Map()
  const agentCtx = { tools: { register(d) { tools.set(d.name, d) } } } // 无 on()，模拟宿主不支持门禁
  const agent = { id: 'x', ctx: agentCtx, session: { id: 'x', header: { cwd } } }
  const m = mountToutiao(agentCtx, {})
  assert.equal(m.gates, false)
  const run = (n, a) => tools.get(n).execute(a, { name: n, arguments: a, agent, token: Symbol('t') })
  const id = (await run('toutiao_article_create', { slug: 'nogate' })).article.id
  await run('toutiao_card_set', { id, card: CARD })
  await run('toutiao_headline_set', { id, main: CARD['主标题'], alts: ['一', '二', '三', '四'] })
  await run('toutiao_draft_stage', { id, text: STORY })
  await run('toutiao_status', { id, to: '待验收' })
  await run('toutiao_qa_check', { id })
  assert.equal((await run('toutiao_status', { id, to: '已验收' })).ok, true)
  await run('toutiao_delivery_save', { id, markdown: deliveryMd(CARD['主标题'], STORY) })
  const r = await run('toutiao_status', { id, to: '已交稿' })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'GATE_DENIED')
})

test('写作台：列表可见，采用后为已交稿；未验收的不能采用', async () => {
  const { call } = await setup()
  const id = (await call('toutiao_article_create', { slug: 'panel' })).article.id
  await call('toutiao_card_set', { id, card: CARD })
  await call('toutiao_headline_set', { id, main: CARD['主标题'], alts: ['一', '二', '三', '四'] })
  await call('toutiao_draft_stage', { id, text: STORY })
  await call('toutiao_status', { id, to: '待验收' })
  const root = (await call('toutiao_article_list', {})).root
  await assert.rejects(adopt(root, id), /只有已验收/)
  await call('toutiao_qa_check', { id })
  await call('toutiao_status', { id, to: '已验收' })
  await call('toutiao_delivery_save', { id, markdown: deliveryMd(CARD['主标题'], STORY) })
  await call('toutiao_ledger_add', { id })
  const html = await __panelTesting.renderList()
  assert.match(html, /精卫填了一辈子海/)
  const m = await adopt(root, id)
  assert.equal(m.status, '已交稿')
  assert.equal((await call('toutiao_ledger_show', {})).rows.at(-1)['状态'], '已交稿', '采用后台账同步')
  assert.equal(m.history.at(-1).by, 'author-panel')
  await assert.rejects(adopt('/etc', id), /未知的存储目录/)
})

test('资讯线长图文无立项卡也能质检，但不能验收', async () => {
  const { call } = await setup()
  const id = (await call('toutiao_article_create', { slug: 'phone' })).article.id
  await call('toutiao_draft_stage', { id, text: LONG })
  await call('toutiao_status', { id, to: '待验收' })
  const qa = await call('toutiao_qa_check', { id })
  assert.equal(qa.pass, true)
  assert.ok(qa.warnings.some(w => /没有立项卡/.test(w)))
  const r = await call('toutiao_status', { id, to: '已验收' })
  assert.equal(r.ok, false)
  assert.match(r.message, /没有立项卡/)
})

test('id 越界与非法 id 被拒绝', async () => {
  const { call } = await setup()
  for (const id of ['../../etc', '2026-01-01-../x', 'x']) {
    const r = await call('toutiao_article_get', { id })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'INVALID_ARGS')
  }
  const s = await call('toutiao_article_create', { slug: '../evil' })
  assert.equal(s.code, 'INVALID_ARGS')
})

test('编辑角色：只挂红笔与质检工具，存稿自动记为 editor；同一会话不能换角色', async () => {
  const { host, call, cwd } = await setup()
  const id = (await call('toutiao_article_create', { slug: 'ed' })).article.id
  await call('toutiao_card_set', { id, card: CARD })
  // 写手不能把自己的稿记成编辑版
  const w = await call('toutiao_draft_stage', { id, text: STORY, role: 'editor' })
  assert.equal(w.ok, true)
  assert.equal((await call('toutiao_article_get', { id })).article.current_rev, 1)
  const ed = host.agent('child-1', cwd)
  const en = await host.call(ed, 'toutiao_enable', { role: 'editor' })
  assert.equal(en.role, 'editor')
  const names = [...ed.scope.tools.keys()].sort()
  assert.ok(names.includes('toutiao_qa_check') && names.includes('toutiao_edit_record'))
  assert.ok(!names.includes('toutiao_status') && !names.includes('toutiao_delivery_save') && !names.includes('toutiao_ledger_add'))
  assert.match(ed.scope.sections[0].text(), /你是独立编辑/)
  await assert.rejects(host.call(ed, 'toutiao_status', { id, to: '待验收' }), /unknown tool/)
  const r = await host.call(ed, 'toutiao_draft_stage', { id, text: STORY + '\n', note: '红笔' })
  assert.equal(r.ok, true)
  const meta = await call('toutiao_article_get', { id })
  assert.deepEqual(meta.article.current_rev, 2)
  const again = await host.call(ed, 'toutiao_enable', { role: 'writer' })
  assert.equal(again.code, 'CONFLICT')
})

test('requireEditorPass：写手版不能直接送验收，编辑版可以', async () => {
  const cwd = await tempDir()
  const host = fakeHost()
  apply(host.root.ctx, { requireEditorPass: true })
  const wr = host.agent('w', cwd), ed = host.agent('e', cwd)
  await host.call(wr, 'toutiao_enable')
  const id = (await host.call(wr, 'toutiao_article_create', { slug: 'ep' })).article.id
  await host.call(wr, 'toutiao_draft_stage', { id, text: STORY })
  const d = await host.call(wr, 'toutiao_status', { id, to: '待验收' })
  assert.equal(d.denied, true)
  assert.match(d.reason, /编辑红笔/)
  await host.call(ed, 'toutiao_enable', { role: 'editor' })
  await host.call(ed, 'toutiao_draft_stage', { id, text: STORY })
  assert.equal((await host.call(wr, 'toutiao_status', { id, to: '待验收' })).ok, true)
})

test('体裁隔离：头条会话拒绝织章工具；织章会话拒绝头条启用', async () => {
  const { host, agent, cwd } = await setup()
  host.root.ctx.tools.register({ name: 'zhizhang_enable', description: '', parameters: { type: 'object' }, output: {}, execute: async () => '已启用织章' })
  const r = await host.call(agent, 'zhizhang_enable')
  assert.equal(r.denied, true)
  assert.match(r.reason, /体裁隔离/)
  const other = host.agent('novel', cwd)
  assert.equal(await host.call(other, 'zhizhang_enable'), '已启用织章')
  const t = await host.call(other, 'toutiao_enable')
  assert.equal(t.denied, true)
  assert.match(t.reason, /番茄长篇/)
})
