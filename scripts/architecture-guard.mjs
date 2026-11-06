import ts from "typescript";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// --root audits another checkout using the same required rules.
const args = process.argv.slice(2);
const rootArg = args.indexOf("--root");
if (rootArg >= 0 && (args[rootArg + 1] === undefined || args[rootArg + 1].startsWith("--"))) {
  console.error("--root 缺少目录参数");
  process.exit(1);
}
const ROOT =
  rootArg < 0
    ? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
    : path.resolve(args[rootArg + 1]);
if (rootArg >= 0) args.splice(rootArg, 2);
if (args.length) {
  console.error(`未知参数：${args.join(" ")}`);
  process.exit(1);
}
const LAYERS = { ui: 0, core: 0, workbench: 1, toutiao: 2, fanqie: 2, desktop: 3 };
const BROWSER_SAFE = [
  "packages/core/src/errors.ts",
  "packages/fanqie/src/engine/domain/manuscript.ts",
];
const problems = [],
  warnings = [],
  graph = new Map(),
  prefixes = new Map();
let anyCount = 0,
  nonNullCount = 0,
  swallowedCount = 0;
const report = (file, message) => problems.push(`${file.rel}: ${message}`);

async function* walk(dir, pattern) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      ![
        "node_modules",
        ".git",
        "build",
        "out",
        "out-test",
        "resources",
        "release",
        "bundle",
        "test-results",
        "playwright-report",
        "outputs",
        "acceptance-results",
        "__pycache__",
      ].includes(entry.name)
    )
      yield* walk(file, pattern);
    else if (pattern.test(file)) yield file;
  }
}

function visit(node, check) {
  check(node);
  ts.forEachChild(node, (child) => visit(child, check));
}

function sourceInfo(file, source, pkg) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const deps = [];
  visit(ast, (node) => {
    let lit,
      typeOnly = false;
    if (ts.isImportDeclaration(node)) {
      lit = node.moduleSpecifier;
      const clause = node.importClause;
      typeOnly =
        !!clause?.isTypeOnly ||
        (!!clause &&
          !clause.name &&
          clause.namedBindings &&
          ts.isNamedImports(clause.namedBindings) &&
          clause.namedBindings.elements.length > 0 &&
          clause.namedBindings.elements.every((item) => item.isTypeOnly));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      lit = node.moduleSpecifier;
      typeOnly = node.isTypeOnly;
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      lit = node.arguments[0];
    }
    if (lit && ts.isStringLiteralLike(lit)) deps.push({ spec: lit.text, typeOnly });
  });
  return {
    file,
    rel,
    pkg,
    ast,
    deps,
    source,
    client: rel.startsWith("packages/workbench/src/client/"),
    renderer: pkg === "desktop" && (rel.includes("/renderer/") || /\.(jsx|tsx)$/.test(file)),
  };
}

function checkDependencies(file) {
  const edges = [];
  for (const { spec, typeOnly } of file.deps) {
    if (
      file.pkg === "desktop" &&
      spec.startsWith("@earendil-works/pi-") &&
      !file.rel.endsWith("/session/pi-adapter.ts")
    )
      report(file, "PI SDK 只能在 session/pi-adapter.ts 使用");
    if (file.renderer && (spec.startsWith("node:") || spec === "electron"))
      report(file, `渲染层不能访问 ${spec}`);
    if (BROWSER_SAFE.includes(file.rel) && spec.startsWith("node:"))
      report(file, "文本分析须保持浏览器可用，不能引用 node 内置模块");
    if (!spec.startsWith(".")) {
      if (file.client && !["react", "react-dom"].includes(spec))
        report(file, `浏览器端不能引用 ${spec}`);
      continue;
    }
    const target = path.resolve(path.dirname(file.file), spec);
    const rel = path.relative(ROOT, target).split(path.sep).join("/");
    const targetPackage = rel.split("/")[1];
    const browserSafe = BROWSER_SAFE.includes(rel.replace(/\.js$/, ".ts"));
    if (
      file.renderer &&
      !rel.startsWith("apps/desktop/src/") &&
      !rel.startsWith("packages/workbench/src/client/") &&
      !rel.startsWith("packages/ui/src/") &&
      !browserSafe
    )
      report(file, `渲染层不能深入服务端模块 ${rel}`);
    if (
      file.client &&
      !rel.startsWith("packages/workbench/src/client/") &&
      !rel.startsWith("packages/workbench/src/adapters/") &&
      !rel.startsWith("packages/ui/src/") &&
      !browserSafe
    )
      report(file, `浏览器端只能引用浏览器可用模块，不能引用 ${rel}`);
    if (
      !file.client &&
      targetPackage in LAYERS &&
      targetPackage !== file.pkg &&
      LAYERS[targetPackage] >= LAYERS[file.pkg]
    )
      report(file, `${file.pkg} 不能依赖同层或上层包 ${targetPackage}`);
    if (
      file.rel.startsWith("packages/fanqie/src/engine/storage/") &&
      /fanqie\/src\/engine\/(panel-|work-store|ports\/)/.test(rel)
    )
      report(file, `存储层不能依赖业务/查询代码 ${rel}`);
    if (BROWSER_SAFE.includes(file.rel) && /\/(storage|ports)\//.test(rel))
      report(file, `文本分析须保持浏览器可用，不能引用 ${rel}`);
    if (!typeOnly) {
      const resolved = ts.resolveModuleName(
        spec,
        file.file,
        { moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true },
        ts.sys,
      ).resolvedModule;
      if (resolved) edges.push(path.resolve(resolved.resolvedFileName));
    }
  }
  graph.set(file.file, edges);
}

function literal(node) {
  if (!node) return true;
  if (ts.isParenthesizedExpression(node)) return literal(node.expression);
  return (
    ts.isLiteralExpression(node) ||
    ts.isObjectLiteralExpression(node) ||
    ts.isArrayLiteralExpression(node) ||
    [
      ts.SyntaxKind.NullKeyword,
      ts.SyntaxKind.TrueKeyword,
      ts.SyntaxKind.FalseKeyword,
      ts.SyntaxKind.VoidExpression,
    ].includes(node.kind) ||
    (ts.isIdentifier(node) && node.text === "undefined")
  );
}

function swallowed(body) {
  if (!ts.isBlock(body)) return literal(body);
  return (
    body.statements.length === 0 ||
    (body.statements.length === 1 &&
      ts.isReturnStatement(body.statements[0]) &&
      literal(body.statements[0].expression))
  );
}

const rules = [
  {
    name: "jsx-copy",
    check(file) {
      if (!file.client && !file.renderer) return;
      visit(file.ast, (node) => {
        if (
          !(
            ts.isJsxText(node) ||
            ts.isStringLiteral(node) ||
            ts.isNoSubstitutionTemplateLiteral(node) ||
            ts.isTemplateHead(node) ||
            ts.isTemplateMiddle(node) ||
            ts.isTemplateTail(node)
          ) ||
          !/[\u4e00-\u9fff]/.test(node.text)
        )
          return;
        let parent = node.parent;
        while (
          parent &&
          !ts.isJsxElement(parent) &&
          !ts.isJsxSelfClosingElement(parent) &&
          !ts.isJsxFragment(parent)
        )
          parent = parent.parent;
        if (parent) report(file, "JSX 中文文案须放入 packages/ui/src/copy.ts");
      });
    },
  },
  {
    name: "type-checking",
    check(file, source) {
      if (source.includes("@ts-nocheck")) report(file, "不许关闭类型检查");
      if (
        file.pkg === "desktop" &&
        file.file.endsWith(".jsx") &&
        !/^\/\/ @ts-check\r?\n/.test(source)
      )
        report(file, "桌面 JSX 必须显式启用 @ts-check 并纳入 renderer 检查");
    },
  },
  {
    name: "renderer-bridge",
    check(file, source) {
      if (
        file.renderer &&
        source.includes("window.writerDesktop") &&
        !file.rel.endsWith("/renderer/state/desktop.ts")
      )
        report(file, "渲染层只能经 state/desktop.ts 访问预加载桥");
      if (file.client && source.includes("window.writerDesktop"))
        report(file, "浏览器端只能通过 adapters 判断宿主，不能直接访问预加载桥");
    },
  },
  {
    name: "component-length",
    check(file, source) {
      if ((file.pkg === "desktop" || file.client) && source.split(/\r?\n/).length > 400)
        warnings.push(`${file.rel}: 超过 400 行，建议按功能拆分`);
    },
  },
  {
    name: "host-package",
    check(file) {
      if (file.source.includes(["@deepseek", "-ai/"].join("")))
        report(file, "禁止引用已退役的宿主包");
    },
  },
  { name: "dependencies", check: checkDependencies },
  {
    name: "any-baseline",
    check(file, source) {
      // 去注释后再数，覆盖 Record<string, any> 等 99 口径看不见的写法；.any() 是 API 名不算。
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .split(/\r?\n/)
        .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
        .join("\n");
      anyCount += [...code.matchAll(/(?<!\.)\bany\b/g)].length;
      // 属性访问/元素访问的非空断言；!:(确定赋值声明)、!=、!== 不算。
      nonNullCount += [...code.matchAll(/(?<=[A-Za-z0-9_$)\]])!(?![=:])/g)].length;
    },
  },
  {
    name: "swallowed-error",
    check(file, source) {
      const lines = source.split(/\r?\n/);
      visit(file.ast, (node) => {
        const caught = ts.isCatchClause(node)
          ? swallowed(node.block)
          : ts.isCallExpression(node) &&
            ts.isPropertyAccessExpression(node.expression) &&
            node.expression.name.text === "catch" &&
            node.arguments.length > 0 &&
            ts.isArrowFunction(node.arguments[0]) &&
            swallowed(node.arguments[0].body);
        if (!caught) return;
        const { line } = file.ast.getLineAndCharacterOfPosition(node.getStart(file.ast));
        if ([lines[line], lines[line - 1]].some((text) => /\/\/\s*allow-catch:\s*\S/.test(text)))
          return;
        swallowedCount++;
        report(file, `${line + 1}: 吞错须注明 // allow-catch: 原因`);
      });
    },
  },
];

const styleRules = [
  {
    name: "style-important",
    check(file, source) {
      if (source.includes("!important")) report(file, "禁止 !important");
    },
  },
  {
    name: "style-tokens",
    check(file, source) {
      if (file.rel.endsWith("tokens.css")) return;
      if (source.split("\n").length > 300)
        warnings.push(`${file.rel}: 样式超过 300 行，建议按组件组织`);
      if (/#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/i.test(source))
        report(file, "颜色须使用 tokens");
      if (/\[data-theme/.test(source)) report(file, "主题只能切换 tokens");
      if (/(?:^|[;{\s])font(?:-size)?\s*:[^;{}]*\b\d+(?:\.\d+)?px/.test(source))
        report(file, "字号须使用 tokens");
    },
  },
  {
    name: "component-prefix",
    check(file, source) {
      // Token scopes supply variables to components; they do not own component styles.
      if (file.rel.endsWith("tokens.css")) return;
      // Read selector preludes, including those inside media/supports blocks, never declarations.
      for (const selector of source.matchAll(/(?:^|(?<=[{}]))\s*([^{}]+)\{/g)) {
        if (selector[1].trim().startsWith("@")) continue;
        for (const part of selector[1].split(",")) {
          const match = part.match(/\.([a-zA-Z_][\w-]*)/);
          if (!match) continue;
          const prefix = match[1].split("-").slice(0, 2).join("-");
          if (!prefixes.has(prefix)) prefixes.set(prefix, new Set());
          prefixes.get(prefix).add(file.rel);
        }
      }
    },
  },
];

for (const pkg of Object.keys(LAYERS)) {
  const dir = path.join(ROOT, pkg === "desktop" ? "apps/desktop/src" : `packages/${pkg}/src`);
  for await (const file of walk(dir, /\.(ts|tsx|js|jsx)$/)) {
    const source = await readFile(file, "utf8");
    const info = sourceInfo(file, source, pkg);
    for (const rule of rules) rule.check(info, source);
  }
}
for (const dir of [
  "apps/desktop/src/styles",
  "packages/ui/src",
  "packages/workbench/src/client/styles",
]) {
  for await (const file of walk(path.join(ROOT, dir), /\.css$/)) {
    const source = (await readFile(file, "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
    const info = { rel: path.relative(ROOT, file) };
    for (const rule of styleRules) rule.check(info, source);
  }
}

const repositoryRules = [
  {
    name: "retired-package",
    async check() {
      for await (const file of walk(ROOT, /\.(ts|tsx|js|jsx|mjs|json|ya?ml|md|py|css)$/)) {
        const source = await readFile(file, "utf8");
        if (source.includes(["@deepseek", "-ai/"].join("")))
          report({ rel: path.relative(ROOT, file) }, "禁止引用已退役的宿主包");
      }
    },
  },
  {
    name: "runtime-cycles",
    check() {
      const active = new Set(),
        done = new Set(),
        stack = [];
      function check(file) {
        if (active.has(file)) {
          problems.push(
            "依赖环：" +
              [...stack.slice(stack.indexOf(file)), file]
                .map((item) => path.relative(ROOT, item))
                .join(" → "),
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
    },
  },
  {
    name: "component-prefix",
    check() {
      for (const [prefix, files] of prefixes) {
        if (files.size > 1) report({ rel: [...files].join(", ") }, `组件前缀 ${prefix} 必须唯一`);
      }
    },
  },
  {
    name: "any-baseline",
    async check() {
      const baseline = JSON.parse(
        await readFile(path.join(ROOT, "scripts/any-baseline.json"), "utf8"),
      );
      if (!Number.isInteger(baseline.any) || baseline.any < 0)
        problems.push('基线文件缺少整数字段 "any"');
      else if (anyCount > baseline.any) problems.push(`any 数量 ${anyCount} 超过基线 ${baseline.any}`);
      if (!Number.isInteger(baseline.nonNull) || baseline.nonNull < 0)
        problems.push('基线文件缺少整数字段 "nonNull"');
      else if (nonNullCount > baseline.nonNull)
        problems.push(`非空断言 ! 数量 ${nonNullCount} 超过基线 ${baseline.nonNull}`);
      console.log(
        `架构守卫计数：any=${anyCount}（基线 ${baseline.any}），非空断言=${nonNullCount}（基线 ${baseline.nonNull}），吞错=${swallowedCount}`,
      );
    },
  },
  {
    name: "versions",
    async check() {
      const versions = [];
      for (const [file, kind] of [
        ["package.json", "json"],
        ["apps/desktop/package.json", "json"],
        ["packages/core/src/version.ts", "ts"],
        ["CHANGELOG.md", "md"],
      ]) {
        const source = await readFile(path.join(ROOT, file), "utf8");
        const version =
          kind === "json"
            ? JSON.parse(source).version
            : kind === "ts"
              ? source.match(/VERSION\s*=\s*"([^"]+)"/)?.[1]
              : source.match(/^##\s+([^\s·]+)/m)?.[1];
        versions.push({ file, version });
      }
      if (new Set(versions.map((item) => item.version)).size !== 1 || !versions[0].version)
        problems.push(
          `版本号不一致：${versions.map((item) => `${item.file}=${item.version}`).join("，")}`,
        );
    },
  },
  {
    name: "history-directory",
    async check() {
      try {
        await stat(path.join(ROOT, "docs", "history"));
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
      problems.push("文档历史目录不得存在");
    },
  },
];
for (const rule of repositoryRules) await rule.check();
if (warnings.length)
  console.warn("架构守卫提示：\n" + [...new Set(warnings)].map((item) => "  - " + item).join("\n"));
if (problems.length) {
  console.error(
    "架构守卫失败：\n" + [...new Set(problems)].map((item) => "  - " + item).join("\n"),
  );
  process.exit(1);
}
console.log(`架构守卫通过：${graph.size} 个源文件；${warnings.length} 条提示`);
