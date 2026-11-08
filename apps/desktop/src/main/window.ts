import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, nativeTheme, shell } from "electron";
import type { Runtime } from "./runtime";

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
    },
  });
  state.window = window;
  window.once("ready-to-show", () => window.show());
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
  window.webContents.session.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'" +
            (rendererOrigin ? " ws: http://localhost:* http://127.0.0.1:*" : "") +
            "; object-src 'none'; base-uri 'none'; frame-src 'none'",
        ],
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
