#!/usr/bin/env node
/**
 * 把写作台浏览器端打成 DSH 客户端模块（build/client.js）：一个脚本调用
 * window.__ModuleLoader__.load({ id, factory })，factory 拿到模块表的 require 并返回导出。
 * React 是唯一的静态外部依赖；宿主的 ui-primitives 等可选模块运行时再取，取不到用本地实现。
 *
 * --check：只在内存里打包并校验，不写文件。
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const clientDir = path.join(root, "packages", "workbench", "src", "client");
const entry = path.join(clientDir, "index.jsx");
const out = path.join(root, "build", "client.js");
const checkOnly = process.argv.includes("--check");
const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
// 浏览器模块 id 必须等于发布包名：DSH 按包名装载客户端、回收样式、匹配插件页
const bundlePkg = JSON.parse(await readFile(path.join(root, "bundle", "package.json"), "utf8"));
const ID = bundlePkg.name;

const banner = [
  "/* " + ID + " " + pkg.version + " — 写作台浏览器端（scripts/build-client.mjs 生成；源码 packages/workbench/src/client/） */",
  "window.__ModuleLoader__.load({",
  "  id: " + JSON.stringify(ID) + ",",
  "  factory: function (require) {",
  "    var module = { exports: {} };",
  "    var exports = module.exports;",
  "    var __dshRequire = require;",
].join("\n");
const footer = ["    return module.exports;", "  },", "});", ""].join("\n");

const result = await build({
  entryPoints: [entry],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: ["chrome110", "safari16", "firefox115"],
  jsx: "transform",
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  external: ["react"],
  loader: { ".css": "text" },
  define: { __WB_VERSION__: JSON.stringify(pkg.version), __WB_PACKAGE__: JSON.stringify(ID), "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  charset: "utf8",
  minifySyntax: true,
  banner: { js: banner },
  footer: { js: footer },
  logLevel: "silent",
});
const code = result.outputFiles[0].text.trimEnd() + "\n";

// Validate the artifact the same way the host will load it, without a browser.
const forbidden = [/\brequire\(["'](?!react["'])[^"']+["']\)/];
for (const pattern of forbidden) {
  const hit = code.match(pattern);
  if (hit) throw new Error("client bundle has an unexpected static import: " + hit[0]);
}
// Colours belong to the host theme: the stylesheet may only use --dsw-* tokens.
const css = await readFile(path.join(clientDir, "styles.css"), "utf8");
const literal = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch)\(/);
if (literal) throw new Error("client CSS contains a colour literal: " + literal[0]);
let descriptor = null;
runInNewContext(code, {
  window: { __ModuleLoader__: { load: (value) => { descriptor = value; } } },
  console,
});
if (!descriptor || descriptor.id !== ID || typeof descriptor.factory !== "function") {
  throw new Error("client bundle did not register through window.__ModuleLoader__.load");
}
const fakeReact = { createElement: () => null, Component: class {}, Fragment: "f", memo: (c) => c, useState: () => [null, () => {}] };
const exportsObj = descriptor.factory((id) => {
  if (id === "react") return fakeReact;
  throw new Error("missing " + id);
});
for (const name of ["apply", "inject"]) {
  if (!(name in exportsObj)) throw new Error("client bundle does not export " + name);
}

if (checkOnly) {
  console.log("build-client: check ok (" + code.length + " bytes)");
} else {
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, code);
  console.log("build-client: wrote", path.relative(root, out), "(" + code.length + " bytes)");
}
