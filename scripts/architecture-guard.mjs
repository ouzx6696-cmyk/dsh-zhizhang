/** Keep the actual dependency direction reviewable, including literal dynamic imports. */
import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('src');
const files = [];
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(file);
    else if (file.endsWith('.ts')) files.push(file);
  }
}
await walk(root);
const known = new Set(files), graph = new Map();
for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (source.includes('@ts-nocheck')) throw new Error(`Type checking disabled: ${path.relative(root, file)}`);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    let literal;
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      if (!(bindings && ts.isNamedImports(bindings) && !node.importClause?.name && bindings.elements.every(x => x.isTypeOnly))) literal = node.moduleSpecifier;
    }
    if (ts.isExportDeclaration(node) && !node.isTypeOnly) literal = node.moduleSpecifier;
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) literal = node.arguments[0];
    if (literal && ts.isStringLiteral(literal) && literal.text.startsWith('.')) {
      const target = path.resolve(path.dirname(file), literal.text.replace(/\.js$/, '.ts'));
      if (known.has(target)) imports.push(target);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  graph.set(file, imports);
  if (file.includes(`${path.sep}storage${path.sep}`) && imports.some(p => /(?:panel-|work-store|\/ports\/)/.test(p)))
    throw new Error(`Storage depends on business/query code: ${path.relative(root, file)}`);
}
const active = new Set(), visited = new Set(), stack = [];
function check(file) {
  if (active.has(file)) throw new Error('Dependency cycle: ' + [...stack.slice(stack.indexOf(file)), file].map(p => path.relative(root, p)).join(' -> '));
  if (visited.has(file)) return;
  active.add(file); stack.push(file);
  for (const next of graph.get(file)) check(next);
  stack.pop(); active.delete(file); visited.add(file);
}
for (const file of files) check(file);
console.log(`Architecture: ${files.length} source modules, no runtime dependency cycles; storage boundaries OK`);
