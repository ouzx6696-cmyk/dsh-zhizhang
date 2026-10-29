// 与真实 DSH 宿主组件的集成测试：@deepseek-ai/cordis + dsh-tools(ToolRuntime) + dsh-scope + dsh-system-prompt。
// 需要一个装好 @deepseek-ai/dsh@0.2.1-rc.4 的目录：WRITER_DSH_RUNTIME=/path/to/dir npm run test:dsh
// 未设置时整组跳过（CI 默认不装 DSH）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { importModule, BUILD, FIX, tempDir } from './helpers.mjs'

const RT = process.env.WRITER_DSH_RUNTIME
const skip = !RT || !existsSync(path.join(RT, 'node_modules', '.pnpm', 'node_modules', '@deepseek-ai', 'dsh-tools')) && !existsSync(path.join(RT, 'node_modules', '@deepseek-ai', 'dsh-tools')) ? '未设置 WRITER_DSH_RUNTIME' : false

async function load(spec) {
  const req = createRequire(path.join(RT, 'node_modules/.pnpm/node_modules/_test.cjs'))
  return import(pathToFileURL(req.resolve(spec)).href)
}

test('真实 DSH ToolRuntime：按会话启用、门禁 deny/ask、作者确认、段落注入', { skip }, async () => {
  const { Context } = await load('@deepseek-ai/cordis')
  const { createScope } = await load('@deepseek-ai/dsh-scope')
  const SystemPrompt = (await load('@deepseek-ai/dsh-system-prompt')).default
  const ToolRuntime = (await load('@deepseek-ai/dsh-tools')).default
  const { ToolCallId } = await load('@deepseek-ai/dsh-llm')
  const plugin = await importModule(path.join(BUILD, 'app/src/index.js'))

  process.env.DSH_HOME = await tempDir('dshhome-')
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  let approve = 'allowed-once'
  const asked = []
  ctx.provide('approval')
  ctx.set('approval', { request: async (r) => { asked.push(r); return approve } })
  await ctx.plugin(plugin, {})

  const cwd = await tempDir()
  const agent = { id: 'sess-1' }
  let scope
  await ctx.plugin(Object.assign((inner) => { scope = createScope(inner, agent) }, { inject: ['tools', 'systemPrompt'] }))
  agent.ctx = scope.ctx
  agent.session = { id: 'sess-1', header: { cwd } }
  const other = { id: 'sess-2' }

  let n = 0
  const call = async (name, args = {}, who = agent) => {
    const r = await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId(`c${++n}`), name, arguments: args, agent: who })
    const text = r.content?.[0]?.text ?? ''
    let value
    try { value = JSON.parse(text) } catch { value = undefined }
    return { r, text, value, isError: r.isError === true || r.ok === false }
  }

  // 挂载前：全局只有触发工具
  assert.deepEqual(ctx.tools.schemas(agent).map(t => t.name).filter(n => n.startsWith('toutiao_')), ['toutiao_enable'])
  const en = await call('toutiao_enable')
  assert.equal(en.value?.ok, true, en.text)
  assert.equal(en.value.prompt_section, true)
  assert.equal(en.value.gates, true)
  const names = ctx.tools.schemas(agent).map(t => t.name)
  assert.ok(names.includes('toutiao_qa_check'))
  assert.ok(!ctx.tools.schemas(other).map(t => t.name).includes('toutiao_qa_check'), '其他会话看不到头条工具')

  const card = JSON.parse(await readFile(path.join(FIX, 'story_long_card.json'), 'utf8'))
  const story = await readFile(path.join(FIX, 'story_long_good.md'), 'utf8')
  const id = (await call('toutiao_article_create', { slug: 'real' })).value.article.id
  assert.equal((await call('toutiao_card_set', { id, card })).value.ready, true)
  await call('toutiao_headline_set', { id, main: card['主标题'], alts: ['一', '二', '三', '四'] })
  await call('toutiao_draft_stage', { id, text: story })
  await call('toutiao_status', { id, to: '待验收' })

  const early = await call('toutiao_status', { id, to: '已验收' })
  assert.equal(early.isError, true, '未质检应被宿主门禁拒绝')
  assert.match(early.text, /toutiao\.accept_requires_qa/)

  const qa = await call('toutiao_qa_check', { id })
  assert.equal(qa.value?.pass, true, qa.text.slice(0, 500))
  assert.equal((await call('toutiao_status', { id, to: '已验收' })).value?.ok, true)
  const md = `# 交稿单 · ${card['主标题']}\n\n主推：${card['主标题']}\n\n${story}`
  assert.equal((await call('toutiao_delivery_save', { id, markdown: md })).value?.ok, true)

  approve = 'rejected'
  const rej = await call('toutiao_status', { id, to: '已交稿' })
  assert.equal(rej.isError, true)
  assert.equal(asked.length, 1)
  assert.equal(asked[0].toolName, 'toutiao_status')

  approve = 'allowed-once'
  const done = await call('toutiao_status', { id, to: '已交稿' })
  assert.equal(done.value?.ok, true, done.text)
  assert.equal(done.value.article.status, '已交稿')

  // 编辑子代理：独立作用域，只有红笔与质检工具
  const mint = async (id) => {
    const a = { id }
    let sc
    await ctx.plugin(Object.assign((inner) => { sc = createScope(inner, a) }, { inject: ['tools', 'systemPrompt'] }))
    a.ctx = sc.ctx
    a.session = { id, header: { cwd } }
    return a
  }
  const editor = await mint('sess-editor')
  const ee = await call('toutiao_enable', { role: 'editor' }, editor)
  assert.equal(ee.value?.role, 'editor', ee.text)
  const en2 = ctx.tools.schemas(editor).map(t => t.name)
  assert.ok(en2.includes('toutiao_qa_check') && !en2.includes('toutiao_status'), en2.join(','))

  // 体裁隔离：经真实 tools/result 观察到织章启用后，该会话拒绝头条；头条会话拒绝织章
  const denied = await call('zhizhang_enable', {}, agent)
  assert.equal(denied.isError, true)
  assert.match(denied.text, /体裁隔离/)
  const novel = await mint('sess-novel')
  assert.match((await call('zhizhang_enable', {}, novel)).text, /^已启用织章/)
  const blocked = await call('toutiao_enable', {}, novel)
  assert.equal(blocked.isError, true)
  assert.match(blocked.text, /番茄长篇/)
})
