/**
 * Electron 桌面端入口：装配 Electron HostPlatform，启动共享组合根与主窗口。
 * 状态目录默认 ~/.zhizhang（ZHIZHANG_STATE_ROOT 可覆盖），随包资源在 resources/zhizhang。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, clipboard, dialog, safeStorage, shell, type BrowserWindow } from "electron";
import { AppError, classify } from "@zhizhang/core/errors";
import { resolveStateRoot, STATE_ROOT_ENV } from "@zhizhang/core/paths";
import { APP_ID, APP_VERSION } from "@zhizhang/core/version";
import type { DesktopEvent } from "../shared/events.js";
import type { Mode } from "../shared/views.js";
import { createAppRuntime } from "./app-runtime.js";
import { runBackup } from "./backup-process.js";
import { registerQuitCleanup } from "./exit.js";
import { registerIpc } from "./ipc/register.js";
import { decodeTextBuffer, type HostPlatform } from "./platform.js";
import type { SecretCipher } from "./services/config.js";
import { createElectronUpdater } from "./updater.js";
import { createMainWindow } from "./window.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const devStateRoot = process.env.ZHIZHANG_USER_DATA?.trim();
if (!app.isPackaged && devStateRoot) process.env[STATE_ROOT_ENV] = devStateRoot;

const resources = app.isPackaged
  ? path.join(process.resourcesPath, "zhizhang")
  : path.resolve(here, "../../resources/zhizhang");
const toutiaoProfile = path.join(resources, "profiles", "toutiao", "default");

const safeStorageCipher: SecretCipher = {
  available: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
  encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
  decrypt: (text) => safeStorage.decryptString(Buffer.from(text, "base64")),
};

async function bootstrap(): Promise<void> {
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);

  let window: BrowserWindow | undefined;
  const parentWindow = () => (window && !window.isDestroyed() ? window : undefined);
  const emit = (event: DesktopEvent) => {
    if (window && !window.isDestroyed()) window.webContents.send("zhizhang:event", event);
  };

  const updater = app.isPackaged ? await createElectronUpdater(APP_VERSION, emit) : undefined;

  const host: HostPlatform = {
    kind: "electron",
    packaged: app.isPackaged,
    platform: process.platform,
    electronVersion: process.versions.electron,
    cipher: safeStorageCipher,
    allowPrivateModelEndpoints: true,
    ...(updater ? { updater } : {}),
    async pickDirectory(title) {
      const win = parentWindow();
      const options = { title, properties: ["openDirectory" as const, "createDirectory" as const] };
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    async pickSave(defaultName, extension) {
      const win = parentWindow();
      const options = {
        title: "导出",
        defaultPath: `${defaultName}.${extension}`,
        filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    async openTextFile(options) {
      const win = parentWindow();
      const extensions = options.extensions ?? ["txt", "md"];
      const dialogOptions = {
        title: options.title ?? "选择文本文件",
        properties: ["openFile" as const],
        filters: [{ name: extensions.join("/").toUpperCase(), extensions }],
      };
      const result = win
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions);
      const file = result.canceled ? undefined : result.filePaths[0];
      if (!file) return null;
      const stat = await fs.stat(file);
      if (stat.size > 20 * 1024 * 1024)
        throw new AppError("input.invalid", "文件超过 20 MB", { field: "file" });
      const decoded = decodeTextBuffer(await fs.readFile(file));
      return { path: file, name: path.basename(file), ...decoded };
    },
    copyText(text) {
      clipboard.writeText(text);
    },
    async openExternal(url) {
      await shell.openExternal(url);
    },
    async openPath(resolvedPath) {
      const failure = await shell.openPath(resolvedPath);
      if (failure) throw new AppError("input.not_found", failure, { path: resolvedPath });
    },
    runBackup,
  };

  const runtime = await createAppRuntime({
    stateRoot: resolveStateRoot(),
    builtinProfilesDir: (mode: Mode) => path.join(resources, "profiles", mode),
    toutiaoProfileDir: toutiaoProfile,
    backupScriptPath: path.join(resources, "scripts", "zhizhang-backup.mjs"),
    host,
    emit,
  });

  registerIpc(runtime.services, () => window);

  window = await createMainWindow(runtime.services.config.settings().appearance, (created) => {
    window = created;
  });
  if (runtime.startupNotice) emit(runtime.startupNotice);

  registerQuitCleanup([["runtime", () => runtime.dispose()]], () => undefined);
  app.on("window-all-closed", () => app.quit());
}

app
  .whenReady()
  .then(bootstrap)
  .catch((error: unknown) => {
    const appErr = classify(error);
    dialog.showErrorBox("织章 启动失败", `${appErr.code}: ${appErr.message}`);
    app.quit();
  });
