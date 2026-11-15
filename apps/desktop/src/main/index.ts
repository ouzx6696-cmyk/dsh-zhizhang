import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, nativeTheme, shell } from "electron";
import {
  setProfilesRoot,
  setStateRoot,
  setWorkspaceHost,
  systemClock,
  VERSION,
} from "@zhizhang/core";
import { isAppError } from "@zhizhang/core/errors";
import { readText, writeAtomic } from "@zhizhang/core/fs";
import { createLockService, type Lease } from "@zhizhang/core/lock";
import { createModelGateway } from "@zhizhang/core/model";
import { DEV_CONTENT_SECURITY_POLICY } from "./csp.js";
import { registerIpc } from "./ipc/register.js";
import { createWorkflowService } from "./workflow.js";
import type { DesktopEvent } from "../shared/events.js";
import type { WorkspaceStatus } from "../shared/ipc.js";
import { DEFAULT_SETTINGS, parseSettings, type AppSettings } from "../shared/settings.js";

if (!app.isPackaged && (process.env.ZHIZHANG_USER_DATA || process.env.WRITER_USER_DATA)) {
  app.setPath("userData", process.env.ZHIZHANG_USER_DATA ?? process.env.WRITER_USER_DATA ?? "");
}

const here = path.dirname(fileURLToPath(import.meta.url));
const BACKGROUND = { night: "#161412", day: "#f6f3ed" } as const;
const locks = createLockService(systemClock);

let mainWindow: BrowserWindow | undefined;
let activeLease: Lease | undefined;
let workspaceStatus: WorkspaceStatus = { root: "", readonly: false };

function emitEvent(event: DesktopEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("zhizhang:event", event);
  }
}

async function claimWorkspaceLease(root: string): Promise<WorkspaceStatus> {
  if (activeLease && activeLease.root === root) {
    return workspaceStatus;
  }
  if (activeLease) {
    await activeLease.release().catch(() => undefined);
    activeLease = undefined;
  }
  try {
    activeLease = await locks.lease(root);
    workspaceStatus = { root, readonly: false };
  } catch (error) {
    if (isAppError(error) && error.code === "storage.locked") {
      const owner =
        error.data && typeof error.data === "object" && "owner" in error.data
          ? String((error.data as { owner?: unknown }).owner ?? "")
          : undefined;
      workspaceStatus = { root, readonly: true, ...(owner ? { owner } : {}) };
    } else {
      throw error;
    }
  }
  return workspaceStatus;
}

async function loadSettings(settingsPath: string): Promise<AppSettings> {
  const raw = await readText(settingsPath);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return parseSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

async function createWindow(settings: AppSettings): Promise<BrowserWindow> {
  const theme =
    settings.appearance.theme === "day" || settings.appearance.theme === "night"
      ? settings.appearance.theme
      : nativeTheme.shouldUseDarkColors
        ? "night"
        : "day";

  const win = new BrowserWindow({
    width: 1380,
    height: 920,
    title: "织章",
    minWidth: 760,
    minHeight: 650,
    show: false,
    backgroundColor: BACKGROUND[theme],
    webPreferences: {
      preload: path.join(here, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 3000);

  const rendererOrigin = process.env.ELECTRON_RENDERER_URL;
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = rendererOrigin
      ? new URL(url).origin === new URL(rendererOrigin).origin
      : url.startsWith("file:") && url.split("#")[0] === win.webContents.getURL().split("#")[0];
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });

  if (rendererOrigin) {
    win.webContents.session.webRequest.onHeadersReceived((details, callback) =>
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [DEV_CONTENT_SECURITY_POLICY],
        },
      }),
    );
  }

  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  const query = { theme };
  await (rendererOrigin
    ? win.loadURL(`${rendererOrigin}?${new URLSearchParams(query)}`)
    : win.loadFile(path.join(here, "../renderer/index.html"), { query }));

  return win;
}

async function bootstrap(): Promise<void> {
  if (process.platform === "win32") app.setAppUserModelId("app.zhizhang.desktop");

  const home = app.getPath("userData");
  await mkdir(home, { recursive: true });
  setStateRoot(home);
  setProfilesRoot(path.join(home, "profiles"));
  setWorkspaceHost(`织章 ${VERSION}`);

  const settingsPath = path.join(home, "settings.json");
  let currentSettings = await loadSettings(settingsPath);
  const initialRoot = currentSettings.workspaceRoot?.trim() || home;
  const initialStatus = await claimWorkspaceLease(initialRoot);

  const gateway = createModelGateway(
    {
      ports: new Map(),
      roles: {},
      limits: currentSettings.engine.concurrency,
      budget: {
        inputBudget: currentSettings.engine.inputBudget,
        runBudget: currentSettings.engine.runBudget,
        moneyCap: currentSettings.engine.moneyCap ?? null,
      },
    },
    systemClock,
  );

  const workflow = createWorkflowService({
    gateway,
    clock: systemClock,
    onEvent: emitEvent,
  });

  registerIpc({
    getWindow: () => mainWindow,
    workflow,
    getSettings: () => currentSettings,
    saveSettings: async (next) => {
      currentSettings = next;
      await writeAtomic(settingsPath, JSON.stringify(next, null, 2));
      const nextRoot = next.workspaceRoot?.trim() || home;
      const status = await claimWorkspaceLease(nextRoot);
      if (status.readonly) {
        emitEvent({
          kind: "notice",
          code: "storage.locked",
          data: { readonly: true, owner: status.owner },
        });
      }
    },
    getWorkspaceStatus: () => workspaceStatus,
    getAppInfo: () => ({ version: VERSION, userData: home }),
  });

  mainWindow = await createWindow(currentSettings);
  if (initialStatus.readonly) {
    mainWindow.webContents.once("did-finish-load", () => {
      emitEvent({
        kind: "notice",
        code: "storage.locked",
        data: { readonly: true, owner: initialStatus.owner },
      });
    });
  }

  app.on("will-quit", () => {
    void activeLease?.release();
  });
  app.on("window-all-closed", () => app.quit());
}

app
  .whenReady()
  .then(bootstrap)
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("织章 启动失败", message);
    app.quit();
  });
