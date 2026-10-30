// 打包 DSH 插件：bundle/dist/index.js（宿主端单文件 ESM，无运行时依赖）+ bundle/dist/client.js（写作台浏览器端）
// + bundle/skill、bundle/skill-fanqie（规则脚本与方法文件）+ bundle/scripts/writer-backup.mjs（长篇数据备份）
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { cp, rm, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'bundle')
const check = process.argv.includes('--check')

await rm(path.join(OUT, 'dist'), { recursive: true, force: true })
await rm(path.join(OUT, 'skill'), { recursive: true, force: true })
await rm(path.join(OUT, 'skill-fanqie'), { recursive: true, force: true })
await rm(path.join(OUT, 'scripts'), { recursive: true, force: true })
await mkdir(path.join(OUT, 'dist'), { recursive: true })

await build({
  entryPoints: [path.join(ROOT, 'packages/app/src/index.ts')],
  outfile: path.join(OUT, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  banner: { js: '// dsh-writer — built by scripts/build-bundle.mjs; source: packages/*/src' },
})

// 写作台浏览器端：scripts/build-client.mjs 生成（模块 id = 本包名）
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-client.mjs')], { stdio: 'inherit' })
await cp(path.join(ROOT, 'build/client.js'), path.join(OUT, 'dist/client.js'))
await mkdir(path.join(OUT, 'scripts'), { recursive: true })
await cp(path.join(ROOT, 'scripts/backup.mjs'), path.join(OUT, 'scripts/writer-backup.mjs'))
const runtimeFiles = src => !src.split(path.sep).some(part => part === 'tests' || part === '__pycache__') && !src.endsWith('.pyc')
await cp(path.join(ROOT, 'packages/toutiao/skill'), path.join(OUT, 'skill'), { recursive: true, filter: runtimeFiles })
await cp(path.join(ROOT, 'packages/fanqie/skill'), path.join(OUT, 'skill-fanqie'), { recursive: true, filter: runtimeFiles })
const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'))
const bpkg = JSON.parse(await readFile(path.join(OUT, 'package.json'), 'utf8'))
if (bpkg.version !== pkg.version) {
  bpkg.version = pkg.version
  await writeFile(path.join(OUT, 'package.json'), JSON.stringify(bpkg, null, 2) + '\n')
}
console.log(`built bundle ${bpkg.name}@${bpkg.version}${check ? ' (check)' : ''}`)
