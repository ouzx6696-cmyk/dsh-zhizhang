/** Optional host acceptance: build and pack once, exercise each writing mode. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
if (!process.env.WRITER_DSH_RUNTIME) throw new Error('请设置 WRITER_DSH_RUNTIME 指向 DSH rc.4 运行时目录。')
const work = mkdtempSync(path.join(tmpdir(), 'writer-host-package-'))
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) {
    if (result.stderr) process.stderr.write(result.stderr)
    throw new Error(`宿主验收退出码 ${result.status}`)
  }
}
try {
  run(process.execPath, ['scripts/build-bundle.mjs', ...(process.argv.includes('--compiled') ? ['--compiled'] : [])])
  run('pnpm', ['pack', '--pack-destination', work], { cwd: path.join(root,'bundle'), shell: process.platform === 'win32', stdio: ['ignore','ignore','pipe'] })
  const filename = readdirSync(work).find(name => name.endsWith('.tgz'))
  if (!filename) throw new Error('未生成测试安装包')
  const env = { ...process.env, WRITER_TEST_BUNDLE: path.join(work,filename) }
  for (const script of ['test/e2e/run-headless.mjs','test/e2e/run-fanqie.mjs']) run(process.execPath, [script], { env })
} finally {
  rmSync(work, { recursive:true, force:true })
}
