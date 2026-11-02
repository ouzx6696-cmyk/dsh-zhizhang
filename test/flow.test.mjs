// 头条 S2→S7 全流程（生产工具执行路径 + 真实 Python 规则脚本）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { FIX, createToolHarness, tempDir, buildUrl } from './helpers.mjs'

const { adopt, listArticles, articleDetail, buildToutiaoDelivery } = await import(buildUrl('toutiao/src/workbench/data.js'))
const { STOP_LINE } = await import(buildUrl('toutiao/src/store.js'))

const STORY = await readFile(path.join(FIX, 'story_long_good.md'), 'utf8')
const CARD = JSON.parse(await readFile(path.join(FIX, 'story_long_card.json'), 'utf8'))
const LONG = await readFile(path.join(FIX, 'long_good.md'), 'utf8')
const BAD = await readFile(path.join(FIX, 'bad.md'), 'utf8')
const TEMPLATE = JSON.parse(await readFile(path.join(FIX, '..', '..', 'templates', 'brief.json'), 'utf8'))
const _d = new Date()
const TODAY = `${_d.getFullYear()}-${String(_d.getMonth() + 1).padStart(2, '0')}-${String(_d.getDate()).padStart(2, '0')}`

async function setup(opts = {}) {
  const cwd = await tempDir()
  return createToolHarness({ mode: 'toutiao', cwd, ...opts })
}

function deliveryMd(title, draft) {
  return `# 交稿单 · ${title}\n\n- **当前状态**：已验收\n\n## 一、标题矩阵\n- 主推：${title}\n\n## 三、终稿正文\n${draft}\n`
}

test('头条工具集、常驻规则与门禁按生产入口创建', async () => {
  const harness = await setup()
  const { TOUTIAO_BRIEF } = await import(buildUrl('toutiao/src/brief.js'))
  assert.ok(![...harness.tools.keys()].some(n => n.startsWith('fanqie_')))
  assert.ok(harness.tools.size >= 18)
  assert.match(TOUTIAO_BRIEF, /AI 到此止步/)
  assert.ok(harness.gates.rules.length > 0)
  await assert.rejects(harness.call('fanqie_chapter_list'), /unknown tool/)
})

test('全流程：故事线长图文 立项→标题→成稿→质检→验收→交稿单→台账→作者采用', async () => {
  const harness = await setup()
  const { call, cwd } = harness
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
  assert.equal(early.code, 'GATE_DENIED', '没质检就验收必须拒绝')
  assert.match(early.message, /还没跑质检/)

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
  assert.equal((await call('toutiao_ledger_add', { id })).ok, true, '重复记账复用现有记录')

  harness.approved = false
  const rej = await call('toutiao_status', { id, to: '已交稿' })
  assert.equal(rej.denied, true)
  assert.equal(harness.approvals.at(-1).name, 'toutiao_status')

  harness.approved = true
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
  assert.equal(r.code, 'GATE_DENIED')
  assert.match(r.message, /立项卡在质检后改过/)

  assert.equal((await call('toutiao_qa_check', { id })).pass, true)
  await call('toutiao_draft_stage', { id, text: STORY + '\n' })
  const st = await call('toutiao_article_get', { id })
  assert.equal(st.article.status, '初稿待改', '新稿回到初稿待改')
  await call('toutiao_status', { id, to: '待验收' })
  const r2 = await call('toutiao_status', { id, to: '已验收' })
  assert.equal(r2.code, 'GATE_DENIED')
  assert.match(r2.message, /还没跑质检/)
})

test('打回超过两轮需作者同意', async () => {
  const harness = await setup()
  const { call } = harness
  const id = (await call('toutiao_article_create', { slug: 'rounds' })).article.id
  await call('toutiao_draft_stage', { id, text: BAD })
  await call('toutiao_status', { id, to: '待验收' })
  const qa = await call('toutiao_qa_check', { id, mode: 'short' })
  assert.equal(qa.pass, false, 'AI 腔稿应打回')
  for (let i = 0; i < 2; i++) {
    assert.equal((await call('toutiao_status', { id, to: '验收退回' })).ok, true)
    await call('toutiao_status', { id, to: '待验收' })
  }
  harness.approved = false
  const third = await call('toutiao_status', { id, to: '验收退回' })
  assert.equal(third.denied, true)
  assert.match(harness.approvals.at(-1).reason, /已打回 2 轮/)
  harness.approved = true
  const ok3 = await call('toutiao_status', { id, to: '验收退回' })
  assert.equal(ok3.ok, true)
  assert.equal(ok3.article.return_rounds, 3)
})

test('工具自身仍拒绝未经作者确认的“已交稿”', async () => {
  const { tools, call, cwd } = await setup()
  const id = (await call('toutiao_article_create', { slug: 'nogate' })).article.id
  await call('toutiao_card_set', { id, card: CARD })
  await call('toutiao_headline_set', { id, main: CARD['主标题'], alts: ['一', '二', '三', '四'] })
  await call('toutiao_draft_stage', { id, text: STORY })
  await call('toutiao_status', { id, to: '待验收' })
  await call('toutiao_qa_check', { id })
  assert.equal((await call('toutiao_status', { id, to: '已验收' })).ok, true)
  await call('toutiao_delivery_save', { id, markdown: deliveryMd(CARD['主标题'], STORY) })
  const result = await tools.get('toutiao_status').execute({ id, to: '已交稿' },
    { cwd, name: 'toutiao_status', arguments: { id, to: '已交稿' }, token: Symbol() })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'GATE_DENIED')
})

test('写作台（今日头条模式）：列表与详情可见，按钮指令按状态生成；采用后为已交稿；未验收的不能采用', async () => {
  const { call } = await setup()
  const id = (await call('toutiao_article_create', { slug: 'panel' })).article.id
  await call('toutiao_card_set', { id, card: CARD })
  await call('toutiao_headline_set', { id, main: CARD['主标题'], alts: ['一', '二', '三', '四'] })
  await call('toutiao_draft_stage', { id, text: STORY })
  await call('toutiao_status', { id, to: '待验收' })
  const root = (await call('toutiao_article_list', {})).root
  const d0 = await articleDetail(root, id)
  await assert.rejects(adopt(root, id, d0.draft), /只有已验收/)
  assert.equal(d0.adoptable, false)
  assert.match(d0.qaProblem, /还没跑质检/)
  assert.equal(d0.draft.rev, 1)
  assert.ok(d0.draft.text.includes(STORY.slice(0, 20)))
  const rv = await buildToutiaoDelivery(root, { action: 'review', id })
  assert.match(rv.text, /^【写作台】派编辑子代理/)
  assert.match(rv.text, /红笔并质检/)
  assert.match((await buildToutiaoDelivery(root, { action: 'new', note: '秋天的柿子' })).text, /题材\/素材：秋天的柿子/)
  await assert.rejects(buildToutiaoDelivery(root, { action: 'continue' }), /须指明文章/)
  await assert.rejects(buildToutiaoDelivery(root, { action: 'publish', id }), /不支持的动作/)
  await call('toutiao_qa_check', { id })
  await call('toutiao_status', { id, to: '已验收' })
  assert.match((await buildToutiaoDelivery(root, { action: 'continue', id, note: '标题再短点' })).text, /出交稿单[\s\S]*作者附言：标题再短点/)
  await call('toutiao_delivery_save', { id, markdown: deliveryMd(CARD['主标题'], STORY) })
  await call('toutiao_ledger_add', { id })
  const list = await listArticles()
  const row = list.articles.find(a => a.id === id)
  assert.equal(row.title, CARD['主标题'])
  assert.equal(row.qa.pass, true)
  const d1 = await articleDetail(root, id)
  assert.equal(d1.adoptable, true)
  assert.match(d1.delivery, /交稿单/)
  await call('toutiao_draft_stage', { id, text: STORY + '\n' })
  await call('toutiao_status', { id, to: '待验收' })
  await call('toutiao_qa_check', { id })
  await call('toutiao_status', { id, to: '已验收' })
  await call('toutiao_delivery_save', { id, markdown: deliveryMd(CARD['主标题'], STORY + '\n') })
  await assert.rejects(adopt(root, id, d1.draft), /版本已变化/)
  assert.equal((await articleDetail(root, id)).status, '已验收')
  const d2 = await articleDetail(root, id)
  const m = await adopt(root, id, d2.draft)
  assert.equal(m.status, '已交稿')
  assert.equal((await call('toutiao_ledger_show', {})).rows.at(-1)['状态'], '已交稿', '采用后台账同步')
  assert.equal(m.history.at(-1).by, 'author-panel')
  await assert.rejects(adopt('/etc', id, d2.draft), /未知的头条数据目录/)
  await assert.rejects(articleDetail('/etc', id), /未知的头条数据目录/)
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

test('编辑角色只可改稿与质检，落盘署名为 editor', async () => {
  const { call, cwd } = await setup()
  const id = (await call('toutiao_article_create', { slug: 'ed' })).article.id
  await call('toutiao_card_set', { id, card: CARD })
  const written = await call('toutiao_draft_stage', { id, text: STORY, role: 'editor' })
  assert.equal(written.ok, true)
  const { ArticleStore } = await import(buildUrl('toutiao/src/store.js'))
  const store = new ArticleStore(path.join(cwd, 'outputs/toutiao'))
  assert.equal((await store.get(id)).drafts[0].role, 'writer')
  const editor = await setup({ cwd, role: 'editor' })
  const { TOUTIAO_EDITOR_BRIEF } = await import(buildUrl('toutiao/src/brief.js'))
  assert.match(TOUTIAO_EDITOR_BRIEF, /你是独立编辑/)
  const names = [...editor.tools.keys()]
  assert.ok(names.includes('toutiao_qa_check') && names.includes('toutiao_edit_record'))
  assert.ok(!names.includes('toutiao_status') && !names.includes('toutiao_delivery_save') && !names.includes('toutiao_ledger_add'))
  await assert.rejects(editor.call('toutiao_status', { id, to: '待验收' }), /unknown tool/)
  assert.equal((await editor.call('toutiao_draft_stage', { id, text: STORY + '\n', note: '红笔' })).ok, true)
  const meta = await store.get(id)
  assert.equal(meta.current_rev, 2)
  assert.equal(meta.drafts.at(-1).role, 'editor')
})

test('requireEditorPass：写手版不能直接送验收，编辑版可以', async () => {
  const cwd = await tempDir()
  const writer = await setup({ cwd, config: { requireEditorPass: true } })
  const editor = await setup({ cwd, role: 'editor', config: { requireEditorPass: true } })
  const id = (await writer.call('toutiao_article_create', { slug: 'ep' })).article.id
  await writer.call('toutiao_draft_stage', { id, text: STORY })
  const denied = await writer.call('toutiao_status', { id, to: '待验收' })
  assert.equal(denied.code, 'GATE_DENIED')
  assert.match(denied.message, /编辑红笔/)
  await editor.call('toutiao_draft_stage', { id, text: STORY })
  assert.equal((await writer.call('toutiao_status', { id, to: '待验收' })).ok, true)
})

test('模式隔离：两种模式只包含各自工具，未知模式在边界拒绝', async () => {
  const toutiao = await setup()
  const fanqie = await createToolHarness({ mode: 'fanqie', cwd: toutiao.cwd })
  assert.ok([...toutiao.tools.keys()].every(name => name.startsWith('toutiao_')))
  assert.ok([...fanqie.tools.keys()].every(name => name.startsWith('fanqie_')))
  await assert.rejects(toutiao.call('fanqie_chapter_list'), /unknown tool/)
  await assert.rejects(fanqie.call('toutiao_article_list'), /unknown tool/)
  await assert.rejects(createToolHarness({ mode: 'unknown', cwd: toutiao.cwd }), /unknown mode/)
})

test('台账并发：同篇重复提交只记一次，改标题后按文章身份同步状态', async () => {
  const { call } = await setup()
  const article = await call('toutiao_article_create', { slug: 'ledger-race' })
  const id = article.article?.id || article.id
  assert.ok(id, JSON.stringify(article))
  assert.equal((await call('toutiao_card_set', { id, card: CARD })).ok, true)
  const added = await Promise.all(Array.from({ length: 8 }, () => call('toutiao_ledger_add', { id })))
  assert.ok(added.every(r => r.ok), JSON.stringify(added))
  let ledger = await call('toutiao_ledger_show', { last: 100 })
  assert.equal(ledger.total, 1)
  assert.equal(ledger.rows[0]['文章ID'], id)
  await call('toutiao_card_set', { id, card: { ...CARD, 主标题: '修改后的标题' } })
  assert.equal((await call('toutiao_ledger_add', { id })).ok, true)
  ledger = await call('toutiao_ledger_show', { last: 100 })
  assert.equal(ledger.total, 1)
})

test('台账并发：20 篇不同文章并发记账并穿插状态同步，无丢行或串写', async () => {
  const { call } = await setup()
  const ids = []
  for (let index = 0; index < 20; index += 1) {
    const created = await call('toutiao_article_create', { slug: 'ledger-fan-' + index })
    const id = created.article?.id || created.id
    assert.ok(id, JSON.stringify(created))
    ids.push(id)
    assert.equal((await call('toutiao_card_set', { id, card: CARD })).ok, true)
    assert.equal(
      (await call('toutiao_draft_stage', { id, text: '# 并发台账\n\n短稿正文。', role: 'writer' })).rev,
      1,
    )
  }
  assert.equal(new Set(ids).size, 20)
  const results = await Promise.all(
    ids.map(async (id) => {
      const added = await call('toutiao_ledger_add', { id })
      const synced = await call('toutiao_status', { id, to: '待验收' })
      return { id, added, synced }
    }),
  )
  for (const result of results) {
    assert.equal(result.added.ok, true, JSON.stringify(result.added))
    assert.equal(result.synced.ok, true, JSON.stringify(result.synced))
  }
  const ledger = await call('toutiao_ledger_show', { last: 100 })
  assert.equal(ledger.total, 20)
  assert.equal(ledger.rows.length, 20)
  assert.deepEqual(
    ledger.rows.map((row) => row['文章ID']).sort(),
    [...ids].sort(),
  )
  assert.ok(ledger.rows.every((row) => row['状态'] === '待验收'), JSON.stringify(ledger.rows))
})
