// 端到端（番茄长篇模式）：真实 dsh headless + 本插件 tgz + 假模型 + 真实 subagent。
// 用法：WRITER_DSH_RUNTIME=<dsh 运行时目录> node test/e2e/run-fanqie.mjs
import { spawn, execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const RT = process.env.WRITER_DSH_RUNTIME
if (!RT) { console.log('跳过：未设置 WRITER_DSH_RUNTIME'); process.exit(0) }
const DSH = path.join(RT, 'node_modules', '.bin', process.platform === 'win32' ? 'dsh.cmd' : 'dsh')

const work = mkdtempSync(path.join(tmpdir(), 'writer-fq-'))
if (process.env.E2E_DEBUG) console.log('work dir', work)
const home = path.join(work, 'dsh-home')
const cwd = path.join(work, 'project')
mkdirSync(cwd, { recursive: true })
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-bundle.mjs')], { stdio: 'ignore' })
execFileSync('npm', ['pack', '--pack-destination', work], { cwd: path.join(ROOT, 'bundle'), stdio: 'ignore', shell: process.platform === 'win32' })
const tgz = path.join(work, readdirSync(work).find(f => f.endsWith('.tgz')))
const env = { ...process.env, DSH_HOME: home }
execFileSync(DSH, ['plugin', '--profile', 'headless', 'add', tgz], { env, cwd: work, stdio: 'ignore' })
writeFileSync(path.join(home, 'profiles/headless/cordis.patch.yml'), '- id: writer\n  config:\n    fanqie:\n      requireEditorPass: true\n')

const body = readFileSync(path.join(ROOT, 'packages/fanqie/skill/forge/novel-writer/assets/examples/两张车票.md'), 'utf8').replace(/^# .*\n+/, '')
const outline = {
  pov: '“我”第一人称', targetWords: 2500, locks: '两张车票，明天八点四十', knowledge: '迟川不知道剧团的事',
  synopsis: '我把车票推给迟川', conflict: '他发现我已答应剧团', beats: '推票—追问—摊牌', ending: '他问什么时候',
}
const W = { work: 'liangzhang' }
const main = [
  ['writer_enable', { mode: 'fanqie' }],                                          // 1 引擎 + 写作层
  ['fanqie_project_create', { title: '两张车票', key: 'liangzhang' }],             // 2
  ['fanqie_outline_set', { ...W, chapter: 'c001', ...outline }],                // 3
  ['fanqie_outline_check', { ...W, chapters: 'c001' }],                            // 4
  ['fanqie_chapter_save', { ...W, chapter: 'c001', title: '第一章 两张车票', content: body, confirm_bypass: true }], // 5
  ['fanqie_style_lint', { ...W, chapter: 'c001' }],                              // 6 语感雷达 + forge 正文体检（已合并）
  ['fanqie_chapter_save', { ...W, chapter: 'c001', status: 'final' }],           // 7 期望拒绝：还没审读
  ['subagent', { description: '长篇编辑审读', prompt: '【编辑任务】【长篇编辑任务】先调用 writer_enable，参数 mode=fanqie、role=editor；作品=liangzhang；章=c001。' }], // 8
  'WAIT',
  ['fanqie_review_get', { ...W, chapter: 'c001' }],                                // 9
  ['fanqie_chapter_save', { ...W, chapter: 'c001', status: 'final' }],           // 10 期望：审读已过 → 进入作者确认 → headless 无审批通道 → 拒绝
  ['writer_enable', { mode: 'toutiao' }],                                         // 11 期望拒绝：模式隔离
]
const editor = [
  ['writer_enable', { mode: 'fanqie', role: 'editor' }],                          // 1
  ['fanqie_chapter_list', W],                                                      // 2
  ['fanqie_chapter_read', { ...W, chapter: 'c001' }],                            // 3
  ['fanqie_candidate_accept', { ...W, chapter: 'c001' }],                        // 4 期望拒绝：编辑只读
  ['fanqie_ledger_check', { ...W, chapters: 'c001' }],                             // 5
  ['fanqie_review_report', { ...W, chapter: 'c001', verdict: '通过', hard_issues: [], levels: [{ level: 'L3', location: '末段', symptom: '略长', fix: '可切段' }], reread_full: true, changed_scope: '未改', strengths: '对白有来回' }], // 6
]
const toSteps = (a) => a.map(x => x === 'WAIT' ? x : { name: x[0], input: x[1] })
const scriptFile = path.join(work, 'script.json')
writeFileSync(scriptFile, JSON.stringify({ main: toSteps(main), editor: toSteps(editor) }))
const logFile = path.join(work, 'mock.log')
const port = 20000 + Math.floor(Math.random() * 2000)
const mock = spawn(process.execPath, [path.join(HERE, 'mock-llm.mjs'), String(port), scriptFile, logFile], { stdio: 'ignore' })
await new Promise(r => setTimeout(r, 800))

try {
  const out = execFileSync(DSH, ['--profile', 'headless', '写番茄长篇第一章'], {
    cwd, env: { ...env, DEEPSEEK_API_KEY: 'sk-mock', DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}` }, encoding: 'utf8', timeout: 280_000,
  })
  const log = readFileSync(logFile, 'utf8')
  if (process.env.E2E_DEBUG) console.log(log)
  assert.match(out, /E2E-DONE/)
  assert.match(log, /\[main\] step 1 OK .*"mode":"fanqie".*番茄长篇引擎/)
  assert.match(log, /\[main\] step 4 OK .*"pass":true/, '章纲检查通过（读到了长篇引擎写入的章纲）')
  assert.match(log, /\[main\] step 6 OK .*forge 正文体检/, '正文体检并入 fanqie_style_lint')
  assert.match(log, /\[main\] step 7 ERR .*还没有编辑审读回报/, '未审读不能定稿')
  assert.match(log, /\[editor\] step 1 OK .*"role":"editor"/)
  assert.match(log, /\[editor\] step 2 OK .*c001/)
  assert.match(log, /\[editor\] step 4 ERR .*fanqie\.editor_readonly/, '编辑不能采纳')
  assert.match(log, /\[editor\] step 6 OK .*"verdict":"通过"/)
  assert.match(log, /\[main\] step 9 OK .*"fresh":true/)
  assert.match(log, /\[main\] step 10 ERR .*requires approval/, '审读通过后定稿仍须作者确认（headless 无审批通道即拒绝）')
  assert.match(log, /\[main\] step 11 OK .*"code":"CONFLICT"/, '长篇会话不能切头条')
  const ch = readFileSync(path.join(cwd, '.writer/works/liangzhang/chapters/c001.md'), 'utf8')
  assert.doesNotMatch(ch, /"status": "final"/, '没有定稿')
  const reviews = readdirSync(path.join(cwd, '.writer/works/liangzhang/writer-reviews/c001'))
  assert.equal(reviews.length, 1, '编辑回报跟着书存在作品目录里')
  const sessions = JSON.parse(readFileSync(path.join(home, 'writer-sessions.json'), 'utf8'))
  const rows = Object.values(sessions)
  assert.equal(rows.length, 1, '只记主会话：真实 subagent 子会话（delegationDepth>0）没有覆盖投递目标')
  assert.ok(!/editor|subagent/i.test(rows[0].sessionId))
  console.log('E2E 通过：真实 dsh headless + 番茄长篇模式 + 编辑子代理；章纲/体检读到长篇数据，4 次拒绝（未审读定稿、编辑采纳、无审批定稿、模式隔离）均符合预期；回报存作品目录；投递目标只记主会话')
} catch (e) {
  try { console.error(readFileSync(logFile, 'utf8')) } catch { /* 无日志 */ }
  throw e
} finally {
  mock.kill()
}
