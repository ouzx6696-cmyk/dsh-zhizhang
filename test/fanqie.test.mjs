// 番茄长篇：在织章作品数据之上跑 forge 规则、编辑审读回报、长篇门禁与体裁路由（假宿主 + 真实 Python）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { BUILD, ROOT, fakeHost, tempDir } from './helpers.mjs'

const { apply } = await import(path.join(BUILD, 'app/src/index.js'))
const EX = await readFile(path.join(ROOT, 'packages/fanqie/skill/forge/novel-writer/assets/examples/两张车票.md'), 'utf8')

const OUTLINE = {
  pov: '“我”第一人称', targetWords: 2500, locks: '两张车票，明天八点四十', knowledge: '迟川不知道剧团的事',
  synopsis: '我把车票推给迟川', conflict: '他发现我已答应剧团', beats: '推票—追问—摊牌', ending: '他问什么时候',
}

/** 按织章 0.20.0 布局造一部作品 */
async function makeWork(cwd, { second = OUTLINE } = {}) {
  const dir = path.join(cwd, '.zhizhang', 'works', 'liangzhang')
  await mkdir(path.join(dir, 'chapters'), { recursive: true })
  const chapters = [
    { id: 'c001', title: '第一章 两张车票', position: 1, status: 'drafted', wordCount: 1000 },
    { id: 'c002', title: '第二章 站台', position: 2, status: 'planned', wordCount: 0 },
  ]
  await writeFile(path.join(dir, 'meta.json'), JSON.stringify({ key: 'liangzhang', title: '两张车票', chapters }))
  const fm = (c, outline) => `---\n${JSON.stringify({ ...c, outline }, null, 2)}\n---\n\n`
  await writeFile(path.join(dir, 'chapters', 'c001.md'), fm(chapters[0], OUTLINE) + EX + '\n')
  await writeFile(path.join(dir, 'chapters', 'c002.md'), fm(chapters[1], second) + '\n')
  return dir
}

function stubZhizhang(host, { fail = false } = {}) {
  const def = (name, value) => ({ name, description: '', parameters: { type: 'object' }, output: {}, execute: async () => value })
  host.root.ctx.tools.register(def('zhizhang_enable', fail ? '错误[no_agent_ctx]：……' : '已启用织章（54 个工具 + 硬规则，仅本会话）。'))
  for (const n of ['zhizhang_chapter_save', 'zhizhang_candidate_accept', 'zhizhang_chapter_read', 'zhizhang_candidate_edit_stage']) host.root.ctx.tools.register(def(n, `${n} ok`))
}

async function setup(config = {}) {
  const cwd = await tempDir()
  await makeWork(cwd)
  const host = fakeHost()
  apply(host.root.ctx, config)
  stubZhizhang(host)
  const agent = host.agent('w', cwd)
  return { host, cwd, agent, call: (n, a) => host.call(agent, n, a) }
}

test('启用长篇：工具、段落、门禁按会话挂载；方法原文带织章对照表', async () => {
  const { host, agent, call } = await setup()
  const en = await call('fanqie_enable')
  assert.equal(en.ok, true)
  assert.equal(en.role, 'writer')
  assert.equal(en.zhizhang_enabled, false)
  assert.match(en.next, /zhizhang_enable/)
  assert.ok(agent.scope.tools.has('fanqie_outline_check') && agent.scope.tools.has('fanqie_review_report'))
  assert.match(agent.scope.sections[0].text(), /番茄长篇/)
  const idx = await call('fanqie_method_get', {})
  assert.ok(idx.key_methods['novel-writer/references/editor_method'])
  const m = await call('fanqie_method_get', { id: 'novel-writer/references/editor_method' })
  assert.match(m.text, /写作 Agent 适配/)
  assert.match(m.text, /四类内容硬伤/)
  const list = await call('fanqie_method_get', { id: 'list' })
  assert.ok(list.methods.length > 60)
  assert.equal((await call('fanqie_method_get', { id: '../../../etc/passwd' })).code, 'OUT_OF_ROOT')
  // 其他会话看不到
  assert.equal(host.agent('other', '/tmp').scope.tools.size, 0)
})

test('章纲检查：读织章章纲，8 字段齐全通过；缺字段与占位报错', async () => {
  const cwd = await tempDir()
  await makeWork(cwd, { second: { ...OUTLINE, synopsis: '', conflict: '【本章主要经历】', targetWords: 9000 } })
  const host = fakeHost()
  apply(host.root.ctx, {})
  const a = host.agent('w', cwd)
  await host.call(a, 'fanqie_enable')
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

test('旧账对照与正文体检：从织章正文取材', async () => {
  const { call, host } = await setup()
  await call('fanqie_enable')
  const led = await call('fanqie_ledger_check', { chapters: '2' })
  assert.equal(led.ok, true)
  assert.ok(led.files.some(n => n.startsWith('第001章-正文')), '默认连带上一章')
  assert.ok(led.items.length > 0)
  assert.ok(led.items.every(i => !i.file.includes('/')), '来源只给文件名')
  assert.equal(host.root.tools.has('fanqie_manuscript_lint'), false, '独立正文体检已合入织章')

})

test('拆书测绘与引文核对：只读会话目录内的文件', async () => {
  const { call, cwd } = await setup()
  await call('fanqie_enable')
  await writeFile(path.join(cwd, 'book.txt'), '第一章 开始\n迟川上了车。\n第二章 中途\n迟川下车。\n')
  const sc = await call('fanqie_library_scan', { file: 'book.txt', keywords: '迟川' })
  assert.equal(sc.chapter_count, 2)
  assert.equal(sc.keyword_frequencies['迟川'], 2)
  assert.equal((await call('fanqie_library_scan', { file: '../../etc/hosts' })).code, 'OUT_OF_ROOT')
  const q = await call('fanqie_quote_check', { source: 'book.txt', analysis_text: '原文写“迟川上了车”，又写“迟川一夜没睡着觉”。', min_chars: 4 })
  assert.equal(q.checked, 2)
  assert.equal(q.not_verbatim, 1)
})

test('审读回报：固定格式、有硬伤不能判通过、绑定正文版本、正文一改就过期', async () => {
  const { call, cwd } = await setup()
  await call('fanqie_enable')
  const hard = [{ category: '正文接续', location: '第 3 段', basis: '与上一章时间矛盾', fix: '改成次日' }]
  const no = await call('fanqie_review_report', { chapter: 'c001', verdict: '通过', hard_issues: hard, levels: [], reread_full: true })
  assert.equal(no.code, 'INVALID_ARGS')
  const badCat = await call('fanqie_review_report', { chapter: 'c001', verdict: '未通过', hard_issues: [{ ...hard[0], category: '文笔' }], levels: [], reread_full: true })
  assert.equal(badCat.code, 'INVALID_ARGS')
  const r = await call('fanqie_review_report', {
    chapter: 'c001', verdict: '通过', hard_issues: [], levels: [{ level: 'L3', location: '末段', symptom: '略长', fix: '切段' }],
    reread_full: true, changed_scope: '未改', strengths: '对白有来回',
  })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.match(r.markdown, /结论：\*\*通过\*\*/)
  const g = await call('fanqie_review_get', { chapter: 'c001' })
  assert.equal(g.fresh, true)
  // 改正文
  const f = path.join(cwd, '.zhizhang/works/liangzhang/chapters/c001.md')
  await writeFile(f, (await readFile(f, 'utf8')).replace('迟川的手停了。', '迟川的手停住了。'))
  const g2 = await call('fanqie_review_get', { chapter: 'c001' })
  assert.equal(g2.fresh, false)
  assert.match(g2.markdown, /回报过期/)
})

test('长篇门禁：定稿与 force 须作者确认；requireEditorPass 时无通过回报不许定稿', async () => {
  const { host, call } = await setup({ fanqie: { requireEditorPass: true } })
  await call('fanqie_enable')
  // 普通保存不拦
  assert.equal(await call('zhizhang_chapter_save', { chapter: 'c001', content: 'x' }), 'zhizhang_chapter_save ok')
  // 定稿：先被"须审读"拒绝
  const d = await call('zhizhang_chapter_save', { chapter: 'c001', status: 'final' })
  assert.equal(d.denied, true)
  assert.match(d.reason, /还没有编辑审读回报/)
  await call('fanqie_review_report', { chapter: 'c001', verdict: '未通过', hard_issues: [{ category: '人物认知', location: '第 5 段', basis: '他不可能知道', fix: '删' }], levels: [], reread_full: true })
  assert.match((await call('zhizhang_chapter_save', { chapter: 'c001', status: 'final' })).reason, /未通过/)
  await call('fanqie_review_report', { chapter: 'c001', verdict: '通过', hard_issues: [], levels: [], reread_full: true })
  // 带新正文定稿：回报对应旧正文 → 拒绝
  assert.match((await call('zhizhang_chapter_save', { chapter: 'c001', status: 'final', content: '全新正文' })).reason, /旧正文/)
  // 版本匹配 → 进入作者确认（ask）
  const before = host.approvals.length
  assert.equal(await call('zhizhang_chapter_save', { chapter: 'c001', status: 'final' }), 'zhizhang_chapter_save ok')
  assert.equal(host.approvals.length, before + 1)
  assert.match(host.approvals.at(-1).reason, /定稿/)
  // force 覆盖
  await call('zhizhang_candidate_accept', { chapter: 'c001', force: true })
  assert.match(host.approvals.at(-1).reason, /force=true/)
  // 作者拒绝 → 不执行
  host.approve = 'denied'
  const rej = await call('zhizhang_chapter_save', { chapter: 'c001', status: 'final' })
  assert.equal(rej.denied, true)
})

test('长篇编辑子代理：只能审读与出编辑候选，写入类织章工具一律拒绝', async () => {
  const { host, cwd } = await setup()
  const ed = host.agent('editor', cwd)
  const en = await host.call(ed, 'fanqie_enable', { role: 'editor' })
  assert.equal(en.role, 'editor')
  assert.match(ed.scope.sections[0].text(), /只审不定稿/)
  assert.equal(await host.call(ed, 'zhizhang_chapter_read', { chapter: 'c001' }), 'zhizhang_chapter_read ok')
  assert.equal(await host.call(ed, 'zhizhang_candidate_edit_stage', {}), 'zhizhang_candidate_edit_stage ok')
  for (const n of ['zhizhang_candidate_accept', 'zhizhang_chapter_save']) {
    const r = await host.call(ed, n, { chapter: 'c001' })
    assert.equal(r.denied, true, n)
    assert.match(r.reason, /fanqie\.editor_readonly/)
  }
  const rep = await host.call(ed, 'fanqie_review_report', { chapter: 'c001', verdict: '通过', hard_issues: [], levels: [], reread_full: true })
  assert.equal(rep.ok, true)
  assert.equal((await host.call(ed, 'fanqie_enable', { role: 'writer' })).code, 'CONFLICT')
})

test('体裁路由：zhizhang_enable 成功即自动挂长篇门禁并锁定体裁；失败回执不算', async () => {
  const { host, cwd, agent, call } = await setup()
  assert.match(await call('zhizhang_enable'), /已启用织章/)
  assert.ok(agent.scope.tools.has('fanqie_review_report'), '自动挂载')
  const t = await call('toutiao_enable')
  assert.equal(t.denied, true)
  assert.match(t.reason, /体裁隔离/)
  // 定稿门禁已生效（未开 requireEditorPass，直接 ask）
  const n = host.approvals.length
  await call('zhizhang_chapter_save', { chapter: 'c001', status: 'final' })
  assert.equal(host.approvals.length, n + 1)
  const en = await call('fanqie_enable')
  assert.equal(en.already_enabled, true)
  assert.equal(en.zhizhang_enabled, true)
  // 头条会话拒绝长篇
  const tt = host.agent('tt', cwd)
  await host.call(tt, 'toutiao_enable')
  assert.equal((await host.call(tt, 'fanqie_enable')).denied, true)
  // 织章启用失败：不锁体裁、不挂载
  const h2 = fakeHost()
  apply(h2.root.ctx, {})
  stubZhizhang(h2, { fail: true })
  const a2 = h2.agent('x', cwd)
  await h2.call(a2, 'zhizhang_enable')
  assert.equal(a2.scope.tools.size, 0)
  assert.equal((await h2.call(a2, 'toutiao_enable')).ok, true)
})

test('autoMount=false：织章启用后不自动挂载', async () => {
  const { agent, call } = await setup({ fanqie: { autoMount: false } })
  await call('zhizhang_enable')
  assert.equal(agent.scope.tools.size, 0)
})
