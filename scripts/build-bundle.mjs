import { execFileSync } from 'node:child_process'
// 打包 DSH 插件：bundle/dist/index.js（单文件 ESM，无运行时依赖）+ bundle/skill（规则脚本与方法文件）
import { build } from 'esbuild'
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'bundle')
// A caller that has just run the full check may reuse its compiled dependencies.
if (!process.argv.includes('--compiled')) {
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', path.join(ROOT,'tsconfig.adapter.json')], {stdio:'inherit'})
  execFileSync(process.execPath, [path.join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', path.join(ROOT,'packages/zhizhang/tsconfig.json')], {stdio:'inherit'})
}
const check = process.argv.includes('--check')

await rm(path.join(OUT, 'dist'), { recursive: true, force: true })
await rm(path.join(OUT, 'skill'), { recursive: true, force: true })
await rm(path.join(OUT, 'skill-fanqie'), { recursive: true, force: true })
await mkdir(path.join(OUT, 'dist'), { recursive: true })

await build({
  entryPoints: [path.join(ROOT, 'packages/app/src/index.ts')],
  outfile: path.join(OUT, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  legalComments: 'none',
  banner: { js: '// dsh-writer — built by scripts/build-bundle.mjs; source: packages/*/src' },
})

// The client is built from the same in-repository source as the server.
process.env.WRITER_CLIENT_ID = 'dsh-writer'
process.env.WRITER_CLIENT_OUT = path.join(OUT, 'dist/client.js')
await import('../packages/zhizhang/scripts/build-client.mjs')

const runtimeAsset = src => !src.split(path.sep).some(part => part === '__pycache__' || part === 'tests') && !src.endsWith('.pyc')
await cp(path.join(ROOT, 'packages/toutiao/skill'), path.join(OUT, 'skill'), { recursive: true, filter: runtimeAsset })
await cp(path.join(ROOT, 'packages/fanqie/skill'), path.join(OUT, 'skill-fanqie'), { recursive: true, filter: runtimeAsset })
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
const bpkg = JSON.parse(await readFile(path.join(OUT, 'package.json'), 'utf8'))
if (bpkg.version !== pkg.version) {
  bpkg.version = pkg.version
  await writeFile(path.join(OUT, 'package.json'), JSON.stringify(bpkg, null, 2) + '\n')
}
console.log(`built bundle ${bpkg.name}@${bpkg.version}${check ? ' (check)' : ''}`)
