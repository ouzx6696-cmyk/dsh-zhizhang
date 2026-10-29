// 端到端：真实 dsh headless + 假模型（Messages SSE）+ 打包好的插件 tgz。
// 用法：WRITER_DSH_RUNTIME=<装了 @deepseek-ai/dsh@0.2.1-rc.4 的目录> node test/e2e/run-headless.mjs
// 步骤：npm pack 插件 → 新建临时 DSH_HOME → dsh plugin add → 启假模型 → dsh --profile headless → 断言日志与产物。
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const RT = process.env.WRITER_DSH_RUNTIME
if (!RT) { console.log('跳过：未设置 WRITER_DSH_RUNTIME'); process.exit(0) }
const DSH = path.join(RT, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh')

const work = mkdtempSync(path.join(tmpdir(), 'writer-e2e-'))
if (process.env.E2E_DEBUG) console.log('work dir', work)
const home = path.join(work, 'dsh-home')
const cwd = path.join(work, 'project')
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-bundle.mjs')], { stdio: 'inherit' })
execFileSync('pnpm', ['pack', '--pack-destination', work], { cwd: path.join(ROOT, 'bundle'), stdio: 'ignore', shell: process.platform === 'win32' })
const tgz = path.join(work, readdirSync(work).find(f => f.endsWith('.tgz')))
const env = { ...process.env, DSH_HOME: home }
execFileSync(DSH, ['plugin', '--profile', 'headless', 'add', tgz], { env, cwd: work, stdio: 'ignore' })
// 打开“写手与编辑分离”
writeFileSync(path.join(home, 'profiles/headless/cordis.patch.yml'), '- id: writer\n  config:\n    requireEditorPass: true\n')

// 脚本：模型依次发出的工具调用
const fix = path.join(ROOT, 'packages/toutiao/skill/tests/fixtures')
const card = JSON.parse(readFileSync(path.join(fix, 'story_long_card.json'), 'utf8'))
const story = readFileSync(path.join(fix, 'story_long_good.md'), 'utf8')
const id = '2026-10-28-e2e'
const md = `# 交稿单 · ${card['主标题']}\n\n主推：${card['主标题']}\n\n${story}`
const main = [
  ['toutiao_enable', {}],
  ['toutiao_article_create', { slug: 'e2e', date: '2026-10-28' }],
  ['toutiao_card_set', { id, card }],
  ['toutiao_headline_set', { id, main: card['主标题'], alts: ['一', '二', '三', '四'] }],
  ['toutiao_draft_stage', { id, text: story, role: 'writer' }],
  ['toutiao_status', { id, to: '待验收' }], // 期望拒绝：requireEditorPass，写手版不能直接送验收
  ['toutiao_status', { id, to: '已验收' }], // 期望拒绝：还没质检
  ['subagent', { description: '头条编辑红笔', prompt: `【编辑任务】先调用 toutiao_enable，参数 role=editor；文章 id=${id}；红笔、存编辑版、跑质检后回报。` }],
  'WAIT',
  ['toutiao_status', { id, to: '待验收' }],
  ['toutiao_status', { id, to: '已验收' }], // 编辑版质检已过线且仍有效
  ['toutiao_delivery_save', { id, markdown: md }],
  ['toutiao_ledger_add', { id }],
  ['toutiao_status', { id, to: '已交稿' }], // headless 无审批通道：期望拒绝（失败即关闭）
  ['zhizhang_enable', {}], // 期望拒绝：体裁隔离（即便未安装织章，也会先被门禁拦下或报未知工具）
]
const editor = [
  ['toutiao_enable', { role: 'editor' }],
  ['toutiao_article_get', { id, include_draft: true }],
  ['toutiao_status', { id, to: '待验收' }], // 编辑看不到这个工具
  ['toutiao_edit_record', { id, rows: [{ 原句: '示例原句', 改后: '示例改后', 病型: 'P3 节奏' }] }],
  ['toutiao_draft_stage', { id, text: story, note: '编辑红笔' }],
  ['toutiao_qa_check', { id }],
]
const toSteps = (a) => a.map(x => x === 'WAIT' ? x : { name: x[0], input: x[1] })
const scriptFile = path.join(work, 'script.json')
writeFileSync(scriptFile, JSON.stringify({ main: toSteps(main), editor: toSteps(editor) }))
const logFile = path.join(work, 'mock.log')
const port = 18000 + Math.floor(Math.random() * 2000)
const mock = spawn(process.execPath, [path.join(HERE, 'mock-llm.mjs'), String(port), scriptFile, logFile], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 800))

try {
  execFileSync('mkdir', ['-p', cwd])
  const out = execFileSync(DSH, ['--profile', 'headless', '写一篇头条'], {
    cwd, env: { ...env, DEEPSEEK_API_KEY: 'sk-mock', DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}` }, encoding: 'utf8', timeout: 120_000,
  })
  const log = readFileSync(logFile, 'utf8')
  if (process.env.E2E_DEBUG) console.log(log)
  assert.match(out, /E2E-DONE/)
  const first = log.match(/\[main\] tools: (.*)\n/)[1].split(',').sort().join(',')
  assert.equal(first, 'subagent,toutiao_enable', '启用前只有触发工具')
  assert.match(log, /\[main\] step 1 OK .*"role":"writer".*"prompt_section":true,"gates":true/)
  assert.match(log, /\[main\] brief-in-messages: true/, '总则进入了后续请求')
  assert.match(log, /\[main\] step 6 ERR .*编辑红笔/, '写手版直接送验收被拒')
  assert.match(log, /\[main\] step 7 ERR .*toutiao\.accept_requires_qa/, '未质检验收被门禁拒绝')
  assert.match(log, /\[editor\] step 1 OK .*"role":"editor"/, '编辑子代理以 editor 启用')
  assert.match(log, /\[editor\] brief-in-messages: false editor-brief: true/, '编辑总则进入子代理请求')
  assert.match(log, /\[editor\] step 3 ERR (?!.*门禁)/, '编辑调不到 toutiao_status（未知工具，而非门禁）')
  assert.match(log, /\[editor\] step 6 OK .*"pass":true/, '编辑质检过线')
  assert.match(log, /\[main\] step 9 OK .*"status":"待验收"/)
  assert.match(log, /\[main\] step 10 OK .*"status":"已验收"/)
  assert.match(log, /\[main\] step 13 ERR .*requires approval/, '无审批通道时已交稿被拒')
  assert.match(log, /\[main\] step 14 ERR /, '织章工具在头条会话不可用')
  const meta = JSON.parse(readFileSync(path.join(cwd, 'outputs/toutiao', id, 'meta.json'), 'utf8'))
  assert.equal(meta.status, '已验收')
  assert.equal(meta.drafts.at(-1).role, 'editor')
  assert.ok(existsSync(path.join(cwd, 'outputs/toutiao', id, '交稿单.md')))
  assert.ok(existsSync(path.join(cwd, 'outputs/toutiao', id, 'edits.json')))
  assert.ok(readFileSync(path.join(cwd, 'outputs/toutiao/log.csv'), 'utf8').includes('精卫填海'))
  console.log('E2E 通过：真实 dsh headless + 编辑子代理跑完 S2→S7；4 次拒绝（编辑分离、未质检、无审批、体裁隔离）均符合预期')
} finally {
  mock.kill()
}
