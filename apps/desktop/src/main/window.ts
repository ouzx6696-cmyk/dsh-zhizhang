import path from "node:path";
import { fileURLToPath } from "node:url";
import { BrowserWindow, shell } from "electron";
import type { Runtime } from "./runtime";

const here = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(state: Runtime) {
  const window = new BrowserWindow({
    width: 1380,
    height: 920,
    title: "写作 Agent",
    minWidth: 760,
    minHeight: 650,
    webPreferences: {
      preload: path.join(here, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  state.window = window;
  const rendererOrigin = process.env.ELECTRON_RENDERER_URL;
  window.webContents.on("will-navigate", (event, url) => {
    const allowed = rendererOrigin
      ? new URL(url).origin === new URL(rendererOrigin).origin
      : url.startsWith("file:") &&
        url.split("#")[0] === window.webContents.getURL().split("#")[0];
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
  return rendererOrigin
    ? window.loadURL(rendererOrigin)
    : window.loadFile(path.join(here, "../renderer/index.html"));
}
