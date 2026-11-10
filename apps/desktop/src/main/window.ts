import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, nativeTheme, shell } from "electron";
import type { Runtime } from "./runtime";
import { guardUnload } from "./exit";
import { DEV_CONTENT_SECURITY_POLICY } from "./csp";
import { fitZoom } from "./zoom";

const here = path.dirname(fileURLToPath(import.meta.url));

// 与 tokens.css 两套主题的 --ui-bg 一致：首帧之前的窗口底色不露白。
const BACKGROUND = { dark: "#101419", light: "#f1ebe0" };

export function createMainWindow(state: Runtime) {
  const { theme } = state.settings.appearance;
  const resolved =
    theme === "system" ? (nativeTheme.shouldUseDarkColors ? "dark" : "light") : theme;
  const window = new BrowserWindow({
    width: 1380,
    height: 920,
    title: "写作 Agent",
    minWidth: 760,
    minHeight: 650,
    show: false,
    backgroundColor: BACKGROUND[resolved],
    webPreferences: {
      preload: path.join(here, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // preload 只用 contextBridge 与 ipcRenderer，沙箱内可用；显式写出，不依赖 Electron 的默认值。
      sandbox: true,
    },
  });
  state.window = window;
  guardUnload(window);
  window.once("ready-to-show", () => window.show());
  // 最大化、全屏或拖大窗口时按窗口内容区等比放大界面（见 zoom.ts），不再四周留黑边。
  const applyZoom = () => {
    if (window.isDestroyed()) return;
    const [width, height] = window.getContentSize();
    const factor = fitZoom(width ?? 0, height ?? 0);
    if (window.webContents.getZoomFactor() !== factor) window.webContents.setZoomFactor(factor);
  };
  for (const event of [
    "resize",
    "maximize",
    "unmaximize",
    "enter-full-screen",
    "leave-full-screen",
  ] as const)
    window.on(event as "resize", applyZoom);
  window.webContents.on("did-finish-load", applyZoom);
  // ready-to-show 依赖首帧；渲染进程启动出错时它不会触发，兜底显示窗口，让错误可见。
  setTimeout(() => {
    if (!window.isDestroyed() && !window.isVisible()) window.show();
  }, 3000);
  const rendererOrigin = process.env.ELECTRON_RENDERER_URL;
  window.webContents.on("will-navigate", (event, url) => {
    const allowed = rendererOrigin
      ? new URL(url).origin === new URL(rendererOrigin).origin
      : url.startsWith("file:") && url.split("#")[0] === window.webContents.getURL().split("#")[0];
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  // 生产构建的策略在 index.html 的 meta 里；响应头只对开发服务器的 http 页面生效。
  if (rendererOrigin)
    window.webContents.session.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [DEV_CONTENT_SECURITY_POLICY],
        },
      }),
    );
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  // 渲染层在挂载前读取主题，syncState 返回前的首帧就用对的配色。
  const query = { theme: resolved };
  return rendererOrigin
    ? window.loadURL(rendererOrigin + "?" + new URLSearchParams(query))
    : window.loadFile(path.join(here, "../renderer/index.html"), { query });
}
