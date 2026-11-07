// Include desktop imports with bundler resolution; tests do not make a production export live.
import ts from "typescript";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
// Windows 上 TS 的 fileName 与 readdir 结果都用正斜杠比较，root 也要归一成 /，
// 否则 startsWith/includes 永不命中，守卫在 win32 恒通过（假绿）
const root = path.resolve(fileURLToPath(new URL("..", import.meta.url))).replace(/\\/g, "/"),
  roots = [];
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const f = dir + "/" + e.name;
    if (e.isDirectory()) await walk(f);
    else if (/\.(ts|tsx|jsx|js)$/.test(f)) roots.push(f);
  }
}
for (const dir of [
  "packages/fanqie/src",
  "packages/toutiao/src",
  "packages/workbench/src",
  "packages/core/src",
  "packages/ui/src",
  "apps/desktop/src",
])
  await walk(root + "/" + dir);
const config = ts.readConfigFile(root + "/tsconfig.json", ts.sys.readFile),
  c = ts.parseJsonConfigFileContent(config.config, ts.sys, root),
  p = ts.createProgram(roots, {
    ...c.options,
    allowJs: true,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  }),
  checker = p.getTypeChecker(),
  uses = new Map();
const resolve = (s) => {
  while (s && s.flags & ts.SymbolFlags.Alias) s = checker.getAliasedSymbol(s);
  return s;
};
for (const sf of p.getSourceFiles().filter((f) => roots.includes(f.fileName))) {
  function visit(n) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) return;
    if (
      ts.isIdentifier(n) &&
      (n.parent.name !== n ||
        ts.isPropertyAccessExpression(n.parent) ||
        ts.isShorthandPropertyAssignment(n.parent))
    ) {
      let s = ts.isShorthandPropertyAssignment(n.parent)
        ? checker.getShorthandAssignmentValueSymbol(n.parent)
        : checker.getSymbolAtLocation(n);
      s = resolve(s);
      if (s) {
        let u = uses.get(s);
        if (!u) {
          u = new Set();
          uses.set(s, u);
        }
        u.add(sf.fileName);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
const result = [];
for (const sf of p
  .getSourceFiles()
  .filter((f) => f.fileName.startsWith(root + "/packages/fanqie/src/"))) {
  const mod = checker.getSymbolAtLocation(sf);
  if (!mod) continue;
  for (let symbol of checker.getExportsOfModule(mod)) {
    symbol = resolve(symbol);
    const decl = symbol.declarations?.find((d) => d.getSourceFile() === sf);
    if (!decl || symbol.name === "default") continue;
    const refs = uses.get(symbol) ?? new Set();
    if (![...refs].some((file) => file !== sf.fileName))
      result.push({
        file: path.relative(root, sf.fileName),
        name: symbol.name,
        local: refs.has(sf.fileName),
        pos: decl.getStart(sf),
      });
  }
}
console.log(`未被其他生产文件使用的番茄导出：${result.length}`);
for (const row of result)
  console.log(`${row.file}: ${row.name} (${row.local ? "仅文件内使用" : "零引用"})`);
process.exitCode = result.length ? 1 : 0;
