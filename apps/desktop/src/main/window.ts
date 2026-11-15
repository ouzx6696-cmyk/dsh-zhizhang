import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, nativeTheme, shell } from "electron";
import type { AppearanceSettings } from "../shared/settings.js";
import { DEV_CONTENT_SECURITY_POLICY } from "./csp.js";
import { guardUnload } from "./exit.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// 与令牌文件两套主题的底色一致：首帧之前的窗口底色不露白。
const BACKGROUND = { dark: "#101419", light: "#f1ebe0" } as const;

export async function createMainWindow(appearance: AppearanceSettings): Promise<BrowserWindow> {
  const resolved: "dark" | "light" =
    appearance.theme === "system"
      ? nativeTheme.shouldUseDarkColors
        ? "dark"
        : "light"
      : appearance.theme;
  const window = new BrowserWindow({
    width: 1380,
    height: 920,
    title: "织章",
    minWidth: 760,
    minHeight: 650,
    show: false,
    backgroundColor: BACKGROUND[resolved],
    webPreferences: {
      preload: path.join(here, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  guardUnload(window);
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
  // 生产构建的策略在 index.html 的 meta 里；响应头只对开发服务器的 http 页面生效。
  if (rendererOrigin) {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [DEV_CONTENT_SECURITY_POLICY],
        },
      }),
    );
  }
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const query = { theme: resolved };
  await (rendererOrigin
    ? window.loadURL(`${rendererOrigin}?${new URLSearchParams(query)}`)
    : window.loadFile(path.join(here, "../renderer/index.html"), { query }));
  return window;
}
