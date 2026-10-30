// 资产清单、更新预设与作者自备资产：
//   1. assets/manifest.json 与磁盘、登记表、版本号一致（scripts/assets.mjs check）；
//   2. 导入上游新版：比对不落盘，--apply 覆盖上游文件、保留本项目文件、改版本号、重建清单、写报告，并指出未登记的新方法；
//   3. 配置 toutiao.assets / fanqie.assets 指定的目录，经 toutiao_method_get / fanqie_forge_get 以 user:… 读取。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BUILD, ROOT, fakeHost, tempDir } from './helpers.mjs'

const SCRIPT = path.join(ROOT, 'scripts/assets.mjs')
const run = (args) => {
  try { return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) } }
  catch (e) { return { code: e.status, out: String(e.stdout) + String(e.stderr) } }
}

test('资产清单与磁盘、登记表、版本号一致', async () => {
  const r = run(['check'])
  assert.equal(r.code, 0, r.out)
  const m = JSON.parse(await readFile(path.join(ROOT, 'assets/manifest.json'), 'utf8'))
  assert.equal(m.sources['toutiao-viral-writer'].loadable, 30)
  assert.equal(m.sources['inspiration-forge-suite'].loadable, 111)
  assert.equal(m.sources['engine-method-assets'].loadable, 12)
  assert.equal(m.sources['toutiao-default-profile'].loadable, 29)
  assert.equal(m.sources['fanqie-default-profile'].loadable, 17)
  // 上游原件之外只有本项目自写的桥接与测试
  const locals = m.entries.filter(e => e.origin === 'local' && e.kind !== 'builtin' && !e.source.endsWith('-default-profile')).map(e => e.path)
  assert.deepEqual(locals.sort(), [
    'packages/fanqie/skill/scripts/fanqie_bridge.py', 'packages/fanqie/skill/tests/test_bridge.py', 'packages/toutiao/skill/scripts/writer_bridge.py',
  ])
  assert.ok(!m.entries.some(e => e.path.includes('__pycache__')))
})

test('导入上游新版：比对、应用、版本号、报告、未登记提示', async () => {
  const root = await tempDir('writer-assets-root-')
  for (const p of ['assets', 'packages/toutiao/skill', 'packages/toutiao/src/methods.ts', 'packages/toutiao/src/brief.ts', 'packages/fanqie/skill', 'packages/fanqie/src/forge.ts', 'packages/toutiao/profiles', 'packages/fanqie/profiles']) {
    await mkdir(path.dirname(path.join(root, p)), { recursive: true })
    await cp(path.join(ROOT, p), path.join(root, p), { recursive: true })
  }
  assert.equal(run(['check', '--root', root]).code, 0)

  // 造一个"4.1.0"上游：改一份方法、加一份、删一份；上游没有本项目的桥接脚本
  const up = path.join(await tempDir('writer-assets-up-'), 'toutiao-viral-writer')
  await cp(path.join(ROOT, 'packages/toutiao/skill'), up, { recursive: true, filter: s => !s.includes('__pycache__') })
  await rm(path.join(up, 'scripts/writer_bridge.py'))
  const skill = await readFile(path.join(up, 'SKILL.md'), 'utf8')
  await writeFile(path.join(up, 'SKILL.md'), skill.replace('全链路写作（4.0.0）', '全链路写作（4.1.0）'))
  await writeFile(path.join(up, 'references/s1-hot.md'), (await readFile(path.join(up, 'references/s1-hot.md'), 'utf8')) + '\n新增一段。\n')
  await writeFile(path.join(up, 'references/s8-review.md'), '# 复盘\n')
  await rm(path.join(up, 'corpus/12-文旅消费.md'))

  const dry = run(['import', 'toutiao-viral-writer', path.dirname(up), '--root', root])
  assert.equal(dry.code, 0, dry.out)
  assert.match(dry.out, /4\.0\.0 → 4\.1\.0/)
  assert.match(dry.out, /新增 1、修改 2、删除 1/)
  assert.ok(existsSync(path.join(root, 'packages/toutiao/skill/corpus/12-文旅消费.md')), '只比对时不落盘')

  const applied = run(['import', 'toutiao-viral-writer', up, '--apply', '--root', root])
  assert.equal(applied.code, 0, applied.out)
  const sources = JSON.parse(await readFile(path.join(root, 'assets/sources.json'), 'utf8'))
  assert.equal(sources.sources.find(s => s.id === 'toutiao-viral-writer').version, '4.1.0')
  assert.match(await readFile(path.join(root, 'packages/toutiao/src/brief.ts'), 'utf8'), /规则 4\.1\.0/)
  assert.ok(existsSync(path.join(root, 'packages/toutiao/skill/scripts/writer_bridge.py')), '本项目文件保留')
  assert.ok(!existsSync(path.join(root, 'packages/toutiao/skill/corpus/12-文旅消费.md')))
  const report = await readFile(path.join(root, 'assets/updates/toutiao-viral-writer-4.1.0.md'), 'utf8')
  assert.match(report, /未登记（模型取不到）：packages\/toutiao\/skill\/references\/s8-review\.md/)
  assert.match(report, /corpus-文旅消费 → corpus\/12-文旅消费\.md 不存在/)

  // 本地改了上游原件而没登记 patched：check 会拦
  await writeFile(path.join(root, 'packages/fanqie/skill/forge/novel-writer/SKILL.md'), 'x')
  assert.match(run(['check', '--root', root]).out, /上游原件被改动/)
})

test('作者自备资产：两种模式都能列出与读取，配置拼错会报错', async () => {
  const { apply } = await import(path.join(BUILD, 'app/src/index.js'))
  const { parseToutiaoConfig } = await import(path.join(BUILD, 'toutiao/src/index.js'))
  const { parseFanqieConfig } = await import(path.join(BUILD, 'fanqie/src/index.js'))
  assert.match(parseToutiaoConfig({ assets: { dir: ['x'] } }).issues[0].message, /toutiao\.assets\.dir 不是有效配置项/)
  assert.match(parseFanqieConfig({ assets: { dirs: 'x' } }).issues[0].message, /fanqie\.assets\.dirs 应为非空字符串数组/)

  const cwd = await tempDir()
  await mkdir(path.join(cwd, '我的方法/标题'), { recursive: true })
  await writeFile(path.join(cwd, '我的方法/标题/养老题.md'), '# 我的标题套路\n先说钱。\n')
  await writeFile(path.join(cwd, '我的方法/笔记.txt'), '人物小传')
  await writeFile(path.join(cwd, '我的方法/图.png'), 'x')
  const host = fakeHost()
  apply(host.root.ctx, { toutiao: { assets: { dirs: ['我的方法', '不存在'] } }, fanqie: { assets: { dirs: [path.join(cwd, '我的方法')] } } })
  const tt = host.agent('tt', cwd), fq = host.agent('fq', cwd)
  await host.call(tt, 'writer_enable', { mode: 'toutiao' })
  await host.call(fq, 'writer_enable', { mode: 'fanqie' })

  const list = await host.call(tt, 'toutiao_method_get', { id: 'list' })
  assert.deepEqual(list.user.map(a => a.id), ['user:标题/养老题', 'user:笔记'])
  assert.ok(list.builtin.includes('s1-hot'))
  assert.match(list.warnings.join(), /资产目录不存在：不存在/)
  const got = await host.call(tt, 'toutiao_method_get', { id: 'user:标题/养老题.md' })
  assert.equal(got.source, 'user'); assert.match(got.text, /先说钱/)
  assert.equal((await host.call(tt, 'toutiao_method_get', { id: 's1-hot' })).file, '默认/s1-hot.md')
  assert.equal((await host.call(tt, 'toutiao_method_get', { id: '原版:s1-hot' })).file, 'references/s1-hot.md')
  const miss = await host.call(tt, 'toutiao_method_get', { id: 'user:没有' })
  assert.equal(miss.ok, false)

  const flist = await host.call(fq, 'fanqie_forge_get', { id: 'list' })
  assert.equal(flist.user.length, 2)
  assert.ok(flist.original.includes('novel-writer/SKILL'))
  assert.match((await host.call(fq, 'fanqie_forge_get', { id: 'user:笔记' })).text, /人物小传/)
  // 越界与自带方法不受影响
  assert.equal((await host.call(fq, 'fanqie_forge_get', { id: 'user:../x' })).ok, false)
  assert.match((await host.call(fq, 'fanqie_forge_get', { id: '原版:novel-writer/SKILL' })).text, /novel-writer/)
})
