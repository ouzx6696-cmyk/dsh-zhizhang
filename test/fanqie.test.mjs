// 番茄长篇模式：真实引擎工具与存储之上的 forge 规则、编辑审读回报、长篇门禁、模式路由与写作台投递（假宿主 + 真实 Python）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { BUILD, ROOT, fakeHost, tempDir } from './helpers.mjs'


const { apply } = await import(path.join(BUILD, 'app/src/index.js'))
const { ensureStorage, createWork, setOutline, saveChapter, readChapter } = await import(path.join(BUILD, 'fanqie/src/engine/store.js'))
const EX = await readFile(path.join(ROOT, 'packages/fanqie/skill/forge/novel-writer/assets/examples/两张车票.md'), 'utf8')

const OUTLINE = {
  pov: '“我”第一人称', targetWords: 2500, locks: '两张车票，明天八点四十', knowledge: '迟川不知道剧团的事',
  synopsis: '我把车票推给迟川', conflict: '他发现我已答应剧团', beats: '推票—追问—摊牌', ending: '他问什么时候',
}
const T1 = '第一章 两张车票'

/** 用长篇引擎自己的存储层造一部作品（<cwd>/.writer，与 fanqie_project_create 同一布局） */
async function makeWork(cwd, { second = OUTLINE } = {}) {
  const paths = await ensureStorage(null, { storageRoot: path.join(cwd, '.writer') })
  const { dir, meta } = await createWork(paths, { title: '两张车票' })
  await setOutline(dir, 'c001', OUTLINE, T1)
  await saveChapter(dir, { id: 'c001', title: T1, body: EX.trim() })
  await setOutline(dir, 'c002', second, '第二章 站台')
  return { dir, key: meta.key }
}

async function setup(config = {}, hostOpts = {}) {
  const cwd = await tempDir()
  const work = await makeWork(cwd)
  const host = fakeHost(hostOpts)
  apply(host.root.ctx, config)
  const agent = host.agent('w', cwd)
  return { host, cwd, agent, work, call: (n, a) => host.call(agent, n, a) }
}

test('启用长篇：writer_enable mode=fanqie 一次挂上引擎与写作层工具、段落、门禁；方法原文带对照表', async () => {
  const { host, agent, call } = await setup()
  assert.deepEqual([...host.root.tools.keys()], ['writer_enable'])
  const en = await call('writer_enable', { mode: 'fanqie' })
  assert.equal(en.ok, true, JSON.stringify(en))
  assert.equal(en.mode, 'fanqie')
  assert.equal(en.role, 'writer')
  assert.match(en.engine, /番茄长篇引擎：\d+ 个工具/)
  assert.match(en.next, /fanqie_project_create/)
  assert.equal(agent.scope.sections.length, 2, '引擎硬规则 + 写作层补充规则')
  assert.ok(agent.scope.tools.has('fanqie_outline_check') && agent.scope.tools.has('fanqie_review_report'))
  assert.ok(agent.scope.tools.has('fanqie_chapter_save') && agent.scope.tools.has('fanqie_method_get') && agent.scope.tools.has('fanqie_forge_get'))
  assert.ok(![...agent.scope.tools.keys()].some(n => n.startsWith('toutiao_')))
  const again = await call('writer_enable', { mode: 'fanqie' })
  assert.equal(again.already_enabled, true)
  assert.ok(!agent.scope.tools.has('fanqie_manuscript_lint'), '已并入 fanqie_style_lint')
  assert.match(agent.scope.sections.map(x => x.text()).join('\n'), /番茄长篇/)
  assert.match(agent.scope.sections.map(x => x.text()).join('\n'), /【写作台】/)
  const idx = await call('fanqie_forge_get', {})
  assert.ok(idx.key_methods.edit, '默认方案目录')
  const m = await call('fanqie_forge_get', { id: 'novel-writer/references/editor_method' })
  assert.equal(m.id, 'edit', '原版 id 对到默认方案里的同类方法')
  assert.match(m.text, /四类/)
  const o = await call('fanqie_forge_get', { id: '原版:novel-writer/references/editor_method' })
  assert.match(o.text, /写作 Agent 适配/)
  assert.match(o.text, /四类内容硬伤/)
  const list = await call('fanqie_forge_get', { id: 'list' })
  assert.equal(list.methods.length, 17)
  assert.ok(list.original.length > 60)
  assert.equal((await call('fanqie_forge_get', { id: '../../../etc/passwd' })).code, 'INVALID_ARGS')
  assert.equal(host.agent('other', '/tmp').scope.tools.size, 0)
})

test('章纲检查：读长篇章纲，8 字段齐全通过；缺字段与占位报错', async () => {
  const cwd = await tempDir()
  await makeWork(cwd, { second: { ...OUTLINE, synopsis: '', conflict: '【本章主要经历】', targetWords: 9000 } })
  const host = fakeHost()
  apply(host.root.ctx, {})
  const a = host.agent('w', cwd)
  await host.call(a, 'writer_enable', { mode: 'fanqie' })
  const ok = await host.call(a, 'fanqie_outline_check', { chapters: '1' })
  assert.equal(ok.pass, true, JSON.stringify(ok))
  const bad = await host.call(a, 'fanqie_outline_check', {})
  assert.equal(bad.pass, false)
  const f = bad.issues.filter(i => i.chapter === 'c002').map(i => i.field)
  assert.ok(f.includes('剧情梗概') && f.includes('核心冲突与看点') && f.includes('目标篇幅'), JSON.stringify(bad.issues))
  assert.equal(bad.field_map.synopsis, '剧情梗概')
  const nf = await host.call(a, 'fanqie_outline_check', { work: '不存在' })
  assert.equal(nf.code, 'NOT_FOUND')
})

test('旧账对照：从长篇引擎正文取材；正文体检并入 fanqie_style_lint 并去重', async () => {
  const { call } = await setup()
  await call('writer_enable', { mode: 'fanqie' })
  const led = await call('fanqie_ledger_check', { chapters: '2' })
  assert.equal(led.ok, true)
  assert.ok(led.files.some(n => n.startsWith('第001章-正文')), '默认连带上一章')
  assert.ok(led.items.length > 0)
  assert.ok(led.items.every(i => !i.file.includes('/')), '来源只给文件名')
  assert.equal((await call('writer_enable', { mode: 'fanqie' })).ok, true)
  const lint = await call('fanqie_style_lint', { chapter: 'c001' })
  assert.match(lint, /### forge 正文体检（\d+ 处，仅提示回看位置）/)
  assert.match(lint, /\d+ 字 · \d+ 段/)
  const txt = await call('fanqie_style_lint', { text: '他眼中闪过一丝寒光，嘴角勾起一抹冷笑。' + '长'.repeat(200) })
  assert.match(txt, /超长段/)
  assert.match(txt, /forge 正文体检/)
})

test('拆书测绘与引文核对：只读会话目录内的文件', async () => {
  const { call, cwd } = await setup()
  await call('writer_enable', { mode: 'fanqie' })
  await writeFile(path.join(cwd, 'book.txt'), '第一章 开始\n迟川上了车。\n第二章 中途\n迟川下车。\n')
  const sc = await call('fanqie_library_scan', { file: 'book.txt', keywords: '迟川' })
  assert.equal(sc.chapter_count, 2)
  assert.equal(sc.keyword_frequencies['迟川'], 2)
  assert.equal((await call('fanqie_library_scan', { file: '../../etc/hosts' })).code, 'OUT_OF_ROOT')
  const q = await call('fanqie_quote_check', { source: 'book.txt', analysis_text: '原文写“迟川上了车”，又写“迟川一夜没睡着觉”。', min_chars: 4 })
  assert.equal(q.checked, 2)
  assert.equal(q.not_verbatim, 1)
})

test('审读回报：固定格式、有硬伤不能判通过、绑定正文版本、跟着书存、正文一改就过期', async () => {
  const { call, work } = await setup()
  await call('writer_enable', { mode: 'fanqie' })
  const hard = [{ category: '正文接续', location: '第 3 段', basis: '与上一章时间矛盾', fix: '改成次日' }]
  assert.equal((await call('fanqie_review_report', { chapter: 'c001', verdict: '通过', hard_issues: hard, levels: [], reread_full: true })).code, 'INVALID_ARGS')
  assert.equal((await call('fanqie_review_report', { chapter: 'c001', verdict: '未通过', hard_issues: [{ ...hard[0], category: '文笔' }], levels: [], reread_full: true })).code, 'INVALID_ARGS')
  const r = await call('fanqie_review_report', {
    chapter: 'c001', verdict: '通过', hard_issues: [], levels: [{ level: 'L3', location: '末段', symptom: '略长', fix: '切段' }],
    reread_full: true, changed_scope: '未改', strengths: '对白有来回',
  })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.match(r.markdown, /结论：\*\*通过\*\*/)
  const { readdir } = await import('node:fs/promises')
  assert.equal((await readdir(path.join(work.dir, 'writer-reviews', 'c001'))).length, 1, '回报存在作品目录里')
  assert.equal((await call('fanqie_review_get', { chapter: 'c001' })).fresh, true)
  await saveChapter(work.dir, { id: 'c001', title: T1, body: EX.trim().replace('迟川的手停了。', '迟川的手停住了。') })
  const g2 = await call('fanqie_review_get', { chapter: 'c001' })
  assert.equal(g2.fresh, false)
  assert.match(g2.markdown, /回报过期/)
})

test('长篇门禁：定稿与 force 须作者确认；requireEditorPass 时无通过回报不许定稿（门禁先拦，长篇引擎内部再兜底）', async () => {
  const { host, call, work } = await setup({ fanqie: { requireEditorPass: true } })
  await call('writer_enable', { mode: 'fanqie' })
  const n0 = host.approvals.length
  // 定稿：先被"须审读"拒绝，且不打扰作者
  const d = await call('fanqie_chapter_save', { chapter: 'c001', status: 'final' })
  assert.equal(d.denied, true)
  assert.match(d.reason, /还没有编辑审读回报/)
  assert.equal(host.approvals.length, n0)
  await call('fanqie_review_report', { chapter: 'c001', verdict: '未通过', hard_issues: [{ category: '人物认知', location: '第 5 段', basis: '他不可能知道', fix: '删' }], levels: [], reread_full: true })
  assert.match((await call('fanqie_chapter_save', { chapter: 'c001', status: 'final' })).reason, /未通过/)
  await call('fanqie_review_report', { chapter: 'c001', verdict: '通过', hard_issues: [], levels: [], reread_full: true })
  // 带新正文定稿：回报对应旧正文 → 拒绝
  assert.match((await call('fanqie_chapter_save', { chapter: 'c001', status: 'final', content: '全新正文' })).reason, /旧正文/)
  // 作者审读声明（长篇引擎自己的规矩：定稿前须声明当前版本已审读）
  const rev = (await readChapter(work.dir, 'c001')).revision
  assert.match(await call('fanqie_chapter_save', { chapter: 'c001', status: 'reviewed', expected_revision: rev, review_summary: '编辑回报通过' }), /已保存/)
  // 版本匹配 → 进入作者确认（ask）→ 真定稿
  const before = host.approvals.length
  assert.match(await call('fanqie_chapter_save', { chapter: 'c001', status: 'final' }), /状态 final/)
  assert.equal(host.approvals.length, before + 1)
  assert.match(host.approvals.at(-1).reason, /定稿/)
  assert.equal((await readChapter(work.dir, 'c001')).status, 'final')
  // force 覆盖须确认；作者拒绝 → 不执行
  host.approve = 'denied'
  const rej = await call('fanqie_chapter_save', { chapter: 'c001', content: '改一句', force: true })
  assert.equal(rej.denied, true)
  assert.match(host.approvals.at(-1).reason, /force=true/)
  assert.equal((await readChapter(work.dir, 'c001')).status, 'final')
})

test('长篇编辑子代理：只能审读与出编辑候选，写入类长篇工具一律拒绝；不被记成投递目标', async () => {
  const { host, cwd, call } = await setup()
  await call('writer_enable', { mode: 'fanqie' })
  await call('fanqie_chapter_list', {})
  const ed = host.agent('editor', cwd)
  ed.session.header.delegationDepth = 1
  const en = await host.call(ed, 'writer_enable', { mode: 'fanqie', role: 'editor' })
  assert.equal(en.role, 'editor')
  assert.match(ed.scope.sections.map(x => x.text()).join('\n'), /只审不定稿/)
  assert.ok(ed.scope.tools.has('fanqie_review_report'))
  assert.match(await host.call(ed, 'fanqie_chapter_read', { chapter: 'c001' }), /两张车票|迟川/)
  for (const n of ['fanqie_candidate_accept', 'fanqie_chapter_save']) {
    const r = await host.call(ed, n, { chapter: 'c001' })
    assert.equal(r.denied, true, n)
    assert.match(r.reason, /fanqie\.editor_readonly/)
  }
  const rep = await host.call(ed, 'fanqie_review_report', { chapter: 'c001', verdict: '通过', hard_issues: [], levels: [], reread_full: true })
  assert.equal(rep.ok, true)
  assert.equal((await host.call(ed, 'writer_enable', { mode: 'fanqie', role: 'writer' })).code, 'CONFLICT')
  const { sessionFor } = await import(path.join(BUILD, 'core/src/sessions.js'))
  assert.equal((await sessionFor(path.join(cwd, '.writer'))).sessionId, 'w', '编辑子代理不覆盖主会话')
})

test('模式路由：长篇会话锁定模式；没有 Agent 作用域不挂载；旧配置项给出迁移提示', async () => {
  const { host, cwd, call } = await setup()
  await call('writer_enable', { mode: 'fanqie' })
  const t = await call('writer_enable', { mode: 'toutiao' })
  assert.equal(t.code, 'CONFLICT')
  const tt = host.agent('tt', cwd)
  await host.call(tt, 'writer_enable', { mode: 'toutiao' })
  assert.equal((await host.call(tt, 'writer_enable', { mode: 'fanqie' })).code, 'CONFLICT')
  assert.equal((await host.call({ id: 'x', session: { id: 'x', header: { cwd } }, scope: undefined }, 'writer_enable', { mode: 'fanqie' })).code, 'NO_AGENT')
  const { Config } = await import(path.join(BUILD, 'app/src/index.js'))
  const v = Config['~standard'].validate({ fanqie: { requireEditorPass: true, storageRoot: '/data/novel' }, toutiao: { rootDir: 'x' }, workbench: { allowLan: true } })
  assert.equal(v.issues, undefined, JSON.stringify(v.issues))
  assert.equal(v.value.fanqie.rootDir, '.writer')
  assert.equal(v.value.fanqie.requireEditorPass, true)
  assert.equal(v.value.workbench.allowLan, true)
  for (const bad of [{ novel: {} }, { requireEditorPass: true }, { fanqie: { autoMount: true } }, { toutiao: 1 }, { workbench: { allowLan: 'yes' } }]) {
    assert.ok(Config['~standard'].validate(bad).issues?.length, JSON.stringify(bad))
  }
})

test('写作台：单章带编辑回报与定稿条件；写作台定稿也受 requireEditorPass 约束；一键续写投递回主会话', async () => {
  const routes = new Map()
  const prompts = []
  const services = {
    webServer: { register: (r) => { routes.set(r.path, r.handler); return () => routes.delete(r.path) } },
    sessionController: { async prompt(req, signal) { assert.ok(signal instanceof AbortSignal); prompts.push(req); return { accepted: true } } },
  }
  const { host, call, work, cwd } = await setup({ fanqie: { requireEditorPass: true } }, { services })
  assert.ok(routes.has('/api/writer/agent/deliver'), '长篇引擎写作台路由随 dsh-writer 注册')
  assert.ok(routes.has('/api/writer/toutiao/articles') && routes.has('/api/writer/toutiao/deliver'), '今日头条模式的接口挂在同一写作台上')
  const server = createServer((req, res) => {
    const h = routes.get(new URL(req.url, 'http://x').pathname.replace(/\/+$/, ''))
    if (!h) { res.writeHead(404); return res.end('{}') }
    return h(req, res)
  })
  await new Promise(r => server.listen(0, '127.0.0.1', r))
  const api = `http://127.0.0.1:${server.address().port}/api/writer`
  const post = (route, body) => fetch(api + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const base = encodeURIComponent(path.join(cwd, '.writer'))
    // 还没有会话用过长篇引擎
    let caps = await (await fetch(`${api}/diagnostics/capabilities?base=${base}`)).json()
    assert.equal(caps.deliver, false, '本项目还没有会话用过长篇引擎')
    await call('writer_enable', { mode: 'fanqie' })
    await call('fanqie_chapter_list', {})
    const projects = await (await fetch(`${api}/projects?refresh=1`)).json()
    const projectId = projects.projects.find(p => p.base === path.join(cwd, '.writer'))?.id ?? decodeURIComponent(base)
    caps = await (await fetch(`${api}/diagnostics/capabilities?base=${encodeURIComponent(projectId)}`)).json()
    assert.equal(caps.deliver, true, JSON.stringify(caps))
    // 单章附带写作层信息
    const chapterUrl = `${api}/chapter?base=${encodeURIComponent(projectId)}&work=${encodeURIComponent(work.key)}&id=c001`
    let ch = await (await fetch(chapterUrl)).json()
    assert.equal(ch.writer.editorReview, null)
    assert.equal(ch.writer.requireEditorPass, true)
    assert.match(ch.writer.finalizeBlocked, /还没有编辑审读回报/)
    // 作者在写作台声明审读后，定稿仍须编辑通过回报
    const req = () => readChapter(work.dir, 'c001').then(c => ({ base: projectId, work: work.key, chapter: 'c001', expectedRevision: c.revision, confirm: true }))
    assert.equal((await post('/chapter/review', await req())).status, 200)
    const blocked = await post('/chapter/finalize', await req())
    assert.equal(blocked.status, 409)
    assert.match((await blocked.json()).error, /还没有编辑审读回报/)
    await call('fanqie_review_report', { chapter: 'c001', verdict: '未通过', hard_issues: [{ category: '本书硬约束', location: '第 2 段', basis: '车票时间写成九点', fix: '改回八点四十' }], levels: [], reread_full: true })
    ch = await (await fetch(chapterUrl)).json()
    assert.equal(ch.writer.editorReview.verdict, '未通过')
    assert.equal(ch.writer.editorReview.stale, false)
    assert.equal(ch.writer.editorReview.hardIssues, 1)
    assert.match(ch.writer.editorReview.summary, /本书硬约束/)
    // 一键：按回报修改 → 投递回主会话 w
    const d = await post('/agent/deliver', { base: projectId, work: work.key, chapter: 'c001', action: 'revise', confirm: true, requestId: 'wb-writer-test-1' })
    assert.equal(d.status, 200, await d.clone().text())
    assert.equal(prompts.at(-1).sessionId, 'w')
    assert.equal(prompts.at(-1).mode, 'queue')
    assert.equal(prompts.at(-1).requestId, 'wb-writer-test-1')
    assert.match(prompts.at(-1).content[0].text, /^【写作台】按最新编辑审读回报修改《两张车票》第 1 章/)
    // 续写下一章 → c002
    await post('/agent/deliver', { base: projectId, work: work.key, action: 'continue', confirm: true })
    assert.match(prompts.at(-1).content[0].text, /续写《两张车票》第 2 章「第二章 站台」/)
    // 通过回报后写作台可以定稿
    await call('fanqie_review_report', { chapter: 'c001', verdict: '通过', hard_issues: [], levels: [], reread_full: true })
    ch = await (await fetch(chapterUrl)).json()
    assert.equal(ch.writer.finalizeBlocked, undefined)
    assert.equal((await post('/chapter/finalize', await req())).status, 200)
    assert.equal((await readChapter(work.dir, 'c001')).status, 'final')

    // 今日头条模式：同一写作台，按头条数据目录找会话投递
    const tcwd = await tempDir()
    let tl = await (await fetch(`${api}/toutiao/articles`)).json()
    assert.equal(tl.deliver, true)
    const tt = host.agent('tt-main', tcwd)
    await host.call(tt, 'writer_enable', { mode: 'toutiao' })
    const aid = (await host.call(tt, 'toutiao_article_create', { slug: 'wb' })).article.id
    await host.call(tt, 'toutiao_draft_stage', { id: aid, text: '第一段。\n\n第二段。' })
    tl = await (await fetch(`${api}/toutiao/articles`)).json()
    const row = tl.articles.find(a => a.id === aid)
    assert.ok(row && tl.sessions[row.root], JSON.stringify(tl))
    const det = await (await fetch(`${api}/toutiao/article?root=${encodeURIComponent(row.root)}&id=${aid}`)).json()
    assert.equal(det.article.draft.rev, 1)
    assert.equal((await post('/toutiao/deliver', { root: row.root, id: aid, action: 'review' })).status, 400, '须确认')
    const td = await post('/toutiao/deliver', { root: row.root, id: aid, action: 'review', confirm: true, requestId: 'wt-test-0001' })
    assert.equal(td.status, 200, await td.clone().text())
    assert.equal(prompts.at(-1).sessionId, 'tt-main')
    assert.equal(prompts.at(-1).requestId, 'wt-test-0001')
    assert.match(prompts.at(-1).content[0].text, /^【写作台】派编辑子代理给《2\d{3}-\d\d-\d\d-wb》（/)
    assert.equal((await post('/toutiao/adopt', { root: row.root, id: aid, confirm: true })).status, 409, '未验收不能采用')
    assert.equal((await post('/toutiao/deliver', { root: '/nope', action: 'new', confirm: true })).status, 409, '没有会话的目录')
  } finally {
    await new Promise(r => server.close(r))
  }
})
