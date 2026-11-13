import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { Script, createContext, runInContext } from "node:vm";
/** 引擎测试用：临时作品与写作台接口服务。 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCommandHarness } from "../helpers.mjs";
import { createWork } from "../../build/fanqie/src/engine/work-store.js";
import { ensureStorage } from "../../build/fanqie/src/engine/storage/paths.js";
export async function withWork(title = "测试作品") {
  const base = await mkdtemp(path.join(tmpdir(), "writer-engine-test-"));
  const paths = await ensureStorage(null, { storageRoot: base });
  const { meta, dir } = await createWork(paths, { title });
  return {
    base,
    paths,
    dir,
    key: meta.key,
    cleanup: () => rm(base, { recursive: true, force: true }),
  };
}
export const createPanel = (config = {}) => createCommandHarness({ fanqie: config });
export const jpost = (api, command, input) => api(command, { kind: "write", input });
export const jget = (api, command, input = {}) => api(command, { input });

/** 依赖包里的自动 JSX（react-markdown）落到注入的 createElement 上。 */
function jsxRuntime(react) {
  const jsx = (type, { children, ...props }, key) =>
    react.createElement(
      type,
      key === undefined ? props : { ...props, key },
      ...(children === undefined ? [] : [children].flat()),
    );
  return { jsx, jsxs: jsx, Fragment: react.Fragment };
}

const bundles = new Map();
/** 打包产物与它的内联 sourcemap，按文件只读一次。 */
function readBundle(file) {
  if (!bundles.has(file)) {
    const url = new URL(`../../build/${file}`, import.meta.url);
    const code = readFileSync(url, "utf8");
    const inline = /\/\/# sourceMappingURL=data:application\/json;base64,(\S+)\s*$/.exec(code);
    if (!inline) throw new Error(`${file} 缺少内联 sourcemap`);
    const map = new SourceMap(JSON.parse(Buffer.from(inline[1], "base64").toString("utf8")));
    bundles.set(file, { url, filename: fileURLToPath(url), code, map });
  }
  return bundles.get(file);
}

/**
 * vm 里执行的脚本不走 Node 的 sourcemap 缓存；在该上下文的 Error 上换算调用栈，
 * 让打包代码里抛出的错误指回源码行。
 */
function mapStacks(context, { url, filename, map }) {
  const place = (frame) => {
    if (frame.getFileName() !== filename) return String(frame);
    const entry = map.findEntry(frame.getLineNumber() - 1, frame.getColumnNumber() - 1);
    if (!entry.originalSource) return String(frame);
    const source = fileURLToPath(new URL(entry.originalSource, url));
    const name = frame.getFunctionName() || "<anonymous>";
    return `${name} (${source}:${entry.originalLine + 1}:${entry.originalColumn + 1})`;
  };
  runInContext("Error", context).prepareStackTrace = (error, frames) =>
    [String(error), ...frames.map((frame) => `    at ${place(frame)}`)].join("\n");
}

/**
 * 每次调用都在新的 vm 上下文里执行一遍打包产物，得到一份全新的模块实例：
 * 模块级单例（提示队列、导航、确认框）不会从上一个用例串过来。
 */
function loadBundle(file, react, globals) {
  const bundle = readBundle(file);
  const module = { exports: {} };
  const context = createContext({
    module,
    exports: module.exports,
    require(id) {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return jsxRuntime(react);
      if (id === "react-dom") return { createPortal: (node) => node };
      throw new Error("Unexpected component dependency: " + id);
    },
    URL,
    AbortController,
    setTimeout,
    clearTimeout,
    // keys.ts 在加载时读平台；要测 macOS 标注的用例自己传 navigator。
    navigator: { platform: "Linux x86_64" },
    ...globals,
  });
  mapStacks(context, bundle);
  new Script(bundle.code, { filename: bundle.filename }).runInContext(context);
  return module.exports;
}

/** 写作区与设计系统组件（test/engine/components.jsx）。 */
export const loadComponents = (react, globals = {}) =>
  loadBundle("test-components.cjs", react, globals);

/**
 * 桌面渲染层模块（test/renderer/entry.ts）。加载时会读 preload 桥（window.writerBridge），
 * Markdown 依赖的实体解码包也会建一个元素备用；默认给空壳，用到它们的用例自己传替身。
 */
export const loadRenderer = (react, globals = {}) =>
  loadBundle("test-renderer.cjs", react, {
    window: { writerBridge: {} },
    document: { createElement: () => ({}) },
    ...globals,
  });
