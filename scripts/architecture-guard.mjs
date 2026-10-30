// 架构守卫：
//   1. 只有 packages/host 可以提到宿主包 @deepseek-ai/*（包括字符串动态导入）；
//   2. 包之间只能按分层向下依赖：host → core / workbench（服务端）→ toutiao / fanqie → app；
//   3. 不许 @ts-nocheck；源码里没有运行时依赖环；
//   4. 长篇引擎的存储层不依赖业务/查询代码，文本分析（manuscript、diagnostics）保持浏览器可用；
//   5. 浏览器端（workbench/src/client）只能引用自己和这两份浏览器可用的文本分析模块。
import ts from 'typescript'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKGS = path.join(ROOT, 'packages')
const LAYERS = { host: 0, core: 1, workbench: 1, toutiao: 2, fanqie: 2, app: 3 }
const BROWSER_SAFE = ['fanqie/src/engine/domain/manuscript.ts', 'fanqie/src/engine/domain/diagnostics.ts']
const problems = []

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (/\.(ts|js|jsx)$/.test(p)) yield p
  }
}

const graph = new Map()
for (const pkg of Object.keys(LAYERS)) {
  for await (const file of walk(path.join(PKGS, pkg, 'src'))) {
    const rel = path.relative(PKGS, file).split(path.sep).join('/')
    const text = await readFile(file, 'utf8')
    if (text.includes('@ts-nocheck')) problems.push(`${rel}: 不许关闭类型检查`)
    const client = rel.startsWith('workbench/src/client/')
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.JSX : undefined)
    const deps = []
    const visit = (node) => {
      let lit, typeOnly = false
      if (ts.isImportDeclaration(node)) {
        lit = node.moduleSpecifier
        const c = node.importClause
        typeOnly = !!c?.isTypeOnly || (!!c && !c.name && c.namedBindings && ts.isNamedImports(c.namedBindings) && c.namedBindings.elements.length > 0 && c.namedBindings.elements.every(x => x.isTypeOnly))
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        lit = node.moduleSpecifier; typeOnly = node.isTypeOnly
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        lit = node.arguments[0]
      }
      if (lit && ts.isStringLiteralLike(lit)) deps.push({ spec: lit.text, typeOnly })
      if (ts.isAsExpression(node) && ts.isStringLiteralLike(node.expression) && node.expression.text.startsWith('@deepseek-ai/')) deps.push({ spec: node.expression.text, typeOnly: false })
      ts.forEachChild(node, visit)
    }
    visit(ast)
    const edges = []
    for (const { spec, typeOnly } of deps) {
      if (spec.startsWith('@deepseek-ai/') && pkg !== 'host') problems.push(`${rel}: 只能经由 packages/host 使用 ${spec}`)
      if (!spec.startsWith('.')) {
        if (client && spec !== 'react') problems.push(`${rel}: 浏览器端不能引用 ${spec}`)
        continue
      }
      const target = path.resolve(path.dirname(file), spec)
      const trel = path.relative(PKGS, target).split(path.sep).join('/')
      const tpkg = trel.split('/')[0]
      if (client) {
        const tts = trel.replace(/\.js$/, '.ts')
        if (!trel.startsWith('workbench/src/client/') && !BROWSER_SAFE.includes(tts)) problems.push(`${rel}: 浏览器端只能引用浏览器可用模块，不能引用 ${trel}`)
        continue
      }
      if (tpkg in LAYERS && tpkg !== pkg && LAYERS[tpkg] >= LAYERS[pkg]) problems.push(`${rel}: ${pkg} 不能依赖同层或上层包 ${tpkg}`)
      if (rel.startsWith('fanqie/src/engine/storage/') && /fanqie\/src\/engine\/(panel-|work-store|ports\/)/.test(trel)) problems.push(`${rel}: 存储层不能依赖业务/查询代码 ${trel}`)
      if (BROWSER_SAFE.includes(rel) && (/\/(storage|ports)\//.test(trel))) problems.push(`${rel}: 文本分析须保持浏览器可用，不能引用 ${trel}`)
      if (!typeOnly) edges.push(path.resolve(PKGS, trel.replace(/\.js$/, '.ts')))
    }
    if (BROWSER_SAFE.includes(rel) && deps.some(d => d.spec.startsWith('node:'))) problems.push(`${rel}: 文本分析须保持浏览器可用，不能引用 node 内置模块`)
    graph.set(file, edges)
  }
}

// 运行时依赖环
const active = new Set(), done = new Set(), stack = []
function check(file) {
  if (active.has(file)) { problems.push('依赖环：' + [...stack.slice(stack.indexOf(file)), file].map(p => path.relative(PKGS, p)).join(' → ')); return }
  if (done.has(file) || !graph.has(file)) return
  active.add(file); stack.push(file)
  for (const next of graph.get(file)) check(next)
  stack.pop(); active.delete(file); done.add(file)
}
for (const file of graph.keys()) check(file)

if (problems.length) {
  console.error('架构守卫失败：\n' + [...new Set(problems)].map(p => '  - ' + p).join('\n'))
  process.exit(1)
}
console.log(`架构守卫通过：${graph.size} 个源文件，分层、宿主边界、存储边界、浏览器边界与依赖环检查均通过`)
