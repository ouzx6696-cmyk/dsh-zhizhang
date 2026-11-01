import { app } from "electron";
import updater from "electron-updater";
import type { Runtime } from "../runtime";
import { handle } from "./handle";
import { releaseWorkspaces } from "../../../../../packages/core/src/workspace-lock";

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
  if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => {});
}

export function registerUpdatesIpc(state: Runtime) {
  handle("updates", async (action) => {
    if (!app.isPackaged) throw new Error("开发环境不下载更新");
    if (action === "download") await autoUpdater.downloadUpdate();
    else if (action === "install") {
      await state.sessions.dispose();
      await releaseWorkspaces();
      autoUpdater.quitAndInstall(false, true);
    } else await autoUpdater.checkForUpdates();
    return state.updateState;
  });
}
