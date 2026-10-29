// Keep the original test suite's package-relative fixtures and subprocesses intact.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../packages/zhizhang/', import.meta.url))
const result = spawnSync(process.execPath, [
  '--test', '--import', './test/setup.mjs',
  'test/domain.test.mjs', 'test/workflow.test.mjs',
  'test/storage.test.mjs', 'test/panel.test.mjs',
], { cwd, stdio: 'inherit', env: process.env })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
