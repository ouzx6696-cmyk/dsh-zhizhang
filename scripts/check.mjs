/** One build and one balanced verification pass for the app and its novel engine. */
import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
const tsc = path.join(root, 'node_modules/typescript/bin/tsc')
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(node, ['scripts/architecture-guard.mjs'])
for (const config of ['tsconfig.adapter.json', 'packages/zhizhang/tsconfig.json']) run(node, [tsc, '-p', config])
run(node, ['packages/zhizhang/scripts/build-client.mjs'])
run(node, [tsc, '-p', 'tsconfig.test.json'])
run(node, ['scripts/link-test-zhizhang.mjs'])

// Use the same configured Python that the plugin itself uses, including paths with spaces.
const { locatePython } = await import(pathToFileURL(path.join(root, 'build/core/src/runner.js')).href)
const python = await locatePython()
for (const script of ['packages/fanqie/skill/tests/test_bridge.py']) {
  run(python.cmd, [...python.prefix, script], { env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } })
}
const tests = (await readdir(path.join(root, 'test'))).filter(name => name.endsWith('.test.mjs')).sort()
run(node, ['--test', ...tests.map(name => path.join('test', name))])
run(node, ['scripts/test-zhizhang.mjs'])
