import { readFileSync } from "node:fs";
import { SourceMap } from "node:module";
import { Script, createContext, runInContext } from "node:vm";
/** 引擎测试用：临时作品与写作台接口服务。 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { createWork } from "../../build/fanqie/src/engine/work-store.js";
import { ensureStorage } from "../../build/fanqie/src/engine/storage/paths.js";
import { fanqieApi } from "../../build/fanqie/src/workbench/api.js";
import { API } from "../../build/workbench/src/routes.js";
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
export async function servePanel(config = {}) {
  const mode = fanqieApi(config);
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://writer.test");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const ctx = {
      url,
      method: req.method,
      path: url.pathname,
      body: async () => (body ? JSON.parse(body) : {}),
      json: (status, data) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(data));
      },
    };
    if (!(await mode.handle(ctx))) ctx.json(404, { ok: false, code: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    api: `http://127.0.0.1:${port}${API}`,
    close: () =>
      new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
export const jpost = (api, route, body) =>
  fetch(`${api}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

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
 * 桌面渲染层模块（test/renderer/entry.ts）。加载时会读 preload 桥（window.writerDesktop），
 * Markdown 依赖的实体解码包也会建一个元素备用；默认给空壳，用到它们的用例自己传替身。
 */
export const loadRenderer = (react, globals = {}) =>
  loadBundle("test-renderer.cjs", react, {
    window: { writerDesktop: {} },
    document: { createElement: () => ({}) },
    ...globals,
  });
