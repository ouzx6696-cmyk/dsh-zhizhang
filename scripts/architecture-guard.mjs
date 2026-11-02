// 架构守卫：
//   1. 只有 packages/host 可以提到宿主包 @deepseek-ai/*（包括字符串动态导入）；
//   2. 包之间只能按分层向下依赖，源码里没有运行时依赖环；
//   3. 长篇引擎的存储层不依赖业务/查询代码，文本分析保持浏览器可用；
//   4. 写作台浏览器端只能引用浏览器可用模块，宿主判断走 adapters；
//   5. 桌面 Pi SDK 只在 session/pi-adapter.ts 导入，渲染层只经 state/desktop.ts 访问预加载桥；
//   6. 样式禁止 !important，桌面/写作台组件文件不超过 400 行（提示）；
//   7. 版本号在 package/bundle/version/CHANGELOG 一致，docs 根目录不超过 10 份。
import ts from "typescript";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKGS = path.join(ROOT, "packages");
const LAYERS = {
  ui: 0,
  host: 0,
  core: 1,
  workbench: 1,
  toutiao: 2,
  fanqie: 2,
  app: 3,
  "host-generic": 2,
  desktop: 3,
};
const BROWSER_SAFE = [
  "fanqie/src/engine/domain/manuscript.ts",
  "fanqie/src/engine/domain/diagnostics.ts",
];
const problems = [];
const warnings = [];

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|tsx|js|jsx)$/.test(p)) yield p;
  }
}

const graph = new Map();
for (const pkg of Object.keys(LAYERS)) {
  for await (const file of walk(
    pkg === "desktop" ? path.join(ROOT, "apps/desktop/src") : path.join(PKGS, pkg, "src"),
  )) {
    const rel = path.relative(PKGS, file).split(path.sep).join("/");
    const text = await readFile(file, "utf8");
    if (text.includes("@ts-nocheck")) problems.push(`${rel}: 不许关闭类型检查`);
    const renderer =
      pkg === "desktop" &&
      (rel.startsWith("../apps/desktop/src/renderer/") || /\.(jsx|tsx)$/.test(file));
    if (
      renderer &&
      text.includes("window.writerDesktop") &&
      !rel.endsWith("apps/desktop/src/renderer/state/desktop.ts")
    )
      problems.push(`${rel}: 渲染层只能经 state/desktop.ts 访问预加载桥`);
    if (
      (pkg === "desktop" || rel.startsWith("workbench/src/client/")) &&
      text.split(/\r?\n/).length > 400
    )
      warnings.push(`${rel}: 超过 400 行，建议按功能拆分`);
    if (pkg === "desktop" && file.endsWith(".jsx") && !/^\/\/ @ts-check\r?\n/.test(text))
      problems.push(`${rel}: 桌面 JSX 必须显式启用 @ts-check 并纳入 renderer 检查`);
    const client = rel.startsWith("workbench/src/client/");
    if (client && text.includes("window.writerDesktop"))
      problems.push(`${rel}: 浏览器端只能通过 adapters 判断宿主，不能直接访问预加载桥`);
    const ast = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.JSX : undefined,
    );
    const deps = [];
    const visit = (node) => {
      let lit,
        typeOnly = false;
      if (ts.isImportDeclaration(node)) {
        lit = node.moduleSpecifier;
        const c = node.importClause;
        typeOnly =
          !!c?.isTypeOnly ||
          (!!c &&
            !c.name &&
            c.namedBindings &&
            ts.isNamedImports(c.namedBindings) &&
            c.namedBindings.elements.length > 0 &&
            c.namedBindings.elements.every((x) => x.isTypeOnly));
      } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
        lit = node.moduleSpecifier;
        typeOnly = node.isTypeOnly;
      } else if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword
      ) {
        lit = node.arguments[0];
      }
      if (lit && ts.isStringLiteralLike(lit)) deps.push({ spec: lit.text, typeOnly });
      if (
        ts.isAsExpression(node) &&
        ts.isStringLiteralLike(node.expression) &&
        node.expression.text.startsWith("@deepseek-ai/")
      )
        deps.push({ spec: node.expression.text, typeOnly: false });
      ts.forEachChild(node, visit);
    };
    visit(ast);
    const edges = [];
    for (const { spec, typeOnly } of deps) {
      if (
        pkg === "desktop" &&
        spec.startsWith("@earendil-works/pi-") &&
        !rel.endsWith("apps/desktop/src/session/pi-adapter.ts")
      )
        problems.push(`${rel}: PI SDK 只能在 session/pi-adapter.ts 使用`);
      if (renderer && (spec.startsWith("node:") || spec === "electron"))
        problems.push(`${rel}: 渲染层不能访问 ${spec}`);
      if (spec.startsWith("@deepseek-ai/") && pkg !== "host")
        problems.push(`${rel}: 只能经由 packages/host 使用 ${spec}`);
      if (!spec.startsWith(".")) {
        if (client && spec !== "react") problems.push(`${rel}: 浏览器端不能引用 ${spec}`);
        continue;
      }
      const target = path.resolve(path.dirname(file), spec);
      const trel = path.relative(PKGS, target).split(path.sep).join("/");
      const tpkg = trel.split("/")[0];
      if (
        renderer &&
        !trel.startsWith("../apps/desktop/src/") &&
        !trel.startsWith("workbench/src/client/") &&
        !trel.startsWith("ui/src/") &&
        !BROWSER_SAFE.includes(trel)
      )
        problems.push(`${rel}: 渲染层不能深入服务端模块 ${trel}`);
      if (client) {
        const tts = trel.replace(/\.js$/, ".ts");
        if (
          !trel.startsWith("workbench/src/client/") &&
          !trel.startsWith("workbench/src/adapters/") &&
          !trel.startsWith("ui/src/") &&
          !BROWSER_SAFE.includes(tts)
        )
          problems.push(`${rel}: 浏览器端只能引用浏览器可用模块，不能引用 ${trel}`);
      }
      if (!client && tpkg in LAYERS && tpkg !== pkg && LAYERS[tpkg] >= LAYERS[pkg])
        problems.push(`${rel}: ${pkg} 不能依赖同层或上层包 ${tpkg}`);
      if (
        rel.startsWith("fanqie/src/engine/storage/") &&
        /fanqie\/src\/engine\/(panel-|work-store|ports\/)/.test(trel)
      )
        problems.push(`${rel}: 存储层不能依赖业务/查询代码 ${trel}`);
      if (BROWSER_SAFE.includes(rel) && /\/(storage|ports)\//.test(trel))
        problems.push(`${rel}: 文本分析须保持浏览器可用，不能引用 ${trel}`);
      if (!typeOnly) {
        const resolved = ts.resolveModuleName(
          spec,
          file,
          { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true },
          ts.sys,
        ).resolvedModule;
        if (resolved) edges.push(path.resolve(resolved.resolvedFileName));
      }
    }
    if (BROWSER_SAFE.includes(rel) && deps.some((d) => d.spec.startsWith("node:")))
      problems.push(`${rel}: 文本分析须保持浏览器可用，不能引用 node 内置模块`);
    graph.set(file, edges);
  }
}

// 运行时依赖环
const active = new Set(),
  done = new Set(),
  stack = [];
function check(file) {
  if (active.has(file)) {
    problems.push(
      "依赖环：" +
        [...stack.slice(stack.indexOf(file)), file].map((p) => path.relative(PKGS, p)).join(" → "),
    );
    return;
  }
  if (done.has(file) || !graph.has(file)) return;
  active.add(file);
  stack.push(file);
  for (const next of graph.get(file)) check(next);
  stack.pop();
  active.delete(file);
  done.add(file);
}
for (const file of graph.keys()) check(file);

async function* styles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* styles(file);
    else if (entry.name.endsWith(".css")) yield file;
  }
}
for (const dir of [
  "apps/desktop/src/styles",
  "packages/ui/src",
  "packages/workbench/src/client/styles",
]) {
  for await (const file of styles(path.join(ROOT, dir))) {
    const css = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    const rel = path.relative(ROOT, file);
    if (css.includes("!important")) problems.push(`${rel}: 禁止 !important`);
    if (rel.endsWith("tokens.css")) continue;
    if (css.split("\n").length > 300) problems.push(`${rel}: 样式超过 300 行`);
    if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i.test(css))
      problems.push(`${rel}: 颜色须使用 tokens`);
    if (/\[data-theme/.test(css)) problems.push(`${rel}: 主题只能切换 tokens`);
    if (/(?:^|[;{\s])font(?:-size)?\s*:[^;{}]*\b\d+(?:\.\d+)?px/.test(css))
      problems.push(`${rel}: 字号须使用 tokens`);
  }
}

if (warnings.length)
  console.warn("架构守卫提示：\n" + [...new Set(warnings)].map((p) => "  - " + p).join("\n"));

const versionFiles = [
  ["package.json", path.join(ROOT, "package.json"), "json"],
  ["apps/desktop/package.json", path.join(ROOT, "apps/desktop/package.json"), "json"],
  ["bundle/package.json", path.join(ROOT, "bundle/package.json"), "json"],
  ["packages/core/src/version.ts", path.join(ROOT, "packages/core/src/version.ts"), "ts"],
  ["CHANGELOG.md", path.join(ROOT, "CHANGELOG.md"), "md"],
];
const versions = [];
for (const [label, file, kind] of versionFiles) {
  const text = await readFile(file, "utf8");
  const version =
    kind === "json"
      ? JSON.parse(text).version
      : kind === "ts"
        ? text.match(/VERSION\s*=\s*"([^"]+)"/)?.[1]
        : text.match(/^##\s+([^\s·]+)/m)?.[1];
  versions.push({ label, version });
}
const distinct = [...new Set(versions.map((v) => v.version))];
if (distinct.length !== 1 || !distinct[0])
  problems.push(`版本号不一致：${versions.map((v) => `${v.label}=${v.version}`).join("，")}`);

const docsRoot = await readdir(path.join(ROOT, "docs"));
const rootDocs = docsRoot.filter((name) => name.endsWith(".md"));
if (rootDocs.length > 10)
  problems.push(
    `docs 根目录有 ${rootDocs.length} 份文档，应不超过 10 份；迭代报告放 docs/history/，使用说明放 docs/guides/`,
  );

if (problems.length) {
  console.error("架构守卫失败：\n" + [...new Set(problems)].map((p) => "  - " + p).join("\n"));
  process.exit(1);
}
console.log(
  `架构守卫通过：${graph.size} 个源文件，分层、宿主边界、存储边界、浏览器边界与依赖环检查均通过；${warnings.length} 条提示`,
);
