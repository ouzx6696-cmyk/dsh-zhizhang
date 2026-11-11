import { app } from "electron";
import updater from "electron-updater";
import type { Runtime } from "../runtime";
import { ipcHandler } from "./handle";

const { autoUpdater } = updater;

export function initUpdates(state: Runtime) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on("checking-for-update", () => {
    state.updateState = { state: "checking", message: "正在检查更新…" };
    state.emit({ updates: state.updateState });
  });
  autoUpdater.on("update-not-available", () => {
    state.updateState = { state: "current", message: "当前已是最新版本" };
    state.emit({ updates: state.updateState });
  });
  autoUpdater.on("update-available", (info) => {
    state.updateState = { state: "available", version: info.version };
    state.emit({ updates: state.updateState });
  });
  autoUpdater.on("download-progress", (info) => {
    state.updateState = { state: "downloading", percent: Math.round(info.percent) };
    state.emit({ updates: state.updateState });
  });
  autoUpdater.on("update-downloaded", () => {
    state.updateState = { state: "downloaded" };
    state.emit({ updates: state.updateState });
  });
  autoUpdater.on("error", () => {
    state.updateState = { state: "error", message: "暂时无法检查更新，请稍后重试" };
    state.emit({ updates: state.updateState });
  });
  // allow-catch: updater emits its error event above, which records and displays the failure.
  if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => {});
}

export function registerUpdatesIpc(state: Runtime) {
  const handle = ipcHandler(state);
  handle("updates", async (action) => {
    if (!app.isPackaged) throw new Error("开发环境不下载更新");
    if (action === "download") await autoUpdater.downloadUpdate();
    // RC-07: sessions and workspace locks are released by the will-quit cleanup, which runs only
    // after every window agreed to close; a cancelled or failed install keeps the work locked.
    else if (action === "install") autoUpdater.quitAndInstall(false, true);
    else await autoUpdater.checkForUpdates();
    return state.updateState;
  });
}
