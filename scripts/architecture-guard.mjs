// 架构守卫：只有 packages/dsh-adapter 可以提到宿主包 @deepseek-ai/*；业务包之间只能按分层向下依赖。
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const LAYERS = { 'dsh-adapter': 0, core: 1, gates: 1, zhizhang: 1, toutiao: 2, fanqie: 2, app: 3 }
const problems = []

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (p.endsWith('.ts')) yield p
  }
}

for (const pkg of Object.keys(LAYERS)) {
  const src = path.join(ROOT, 'packages', pkg, 'src')
  for await (const file of walk(src)) {
    const text = await readFile(file, 'utf8')
    for (const m of text.matchAll(/(?:import|export)[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2]
      const rel = path.relative(ROOT, file)
      if (spec.startsWith('@deepseek-ai/') && pkg !== 'dsh-adapter') problems.push(`${rel}: 业务包不得直接引用 ${spec}，请经由 packages/dsh-adapter`)
      if (spec.startsWith('.')) {
        const target = path.resolve(path.dirname(file), spec)
        const tp = path.relative(path.join(ROOT, 'packages'), target).split(path.sep)[0]
        if (pkg === 'zhizhang' && tp === 'dsh-adapter') continue
        if (tp && tp in LAYERS && tp !== pkg && LAYERS[tp] >= LAYERS[pkg]) problems.push(`${rel}: ${pkg} 不能依赖同层或上层包 ${tp}`)
      }
    }
  }
}
if (problems.length) {
  console.error('架构守卫失败：\n' + problems.map(p => '  - ' + p).join('\n'))
  process.exit(1)
}
console.log('架构守卫通过')
