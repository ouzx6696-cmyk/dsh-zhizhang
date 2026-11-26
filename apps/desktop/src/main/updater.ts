/**
 * 桌面端自动更新适配器：封装 electron-updater 状态机与实时进度推送。
 * 通过驱动接口解耦，便于单元测试验证状态流转，同时保证 Web 预览零 Electron 依赖。
 */
import { classify } from "@zhizhang/core/errors";
import type { DesktopEvent } from "../shared/events.js";
import type { UpdateAction, UpdateStatus } from "../shared/views.js";
import type { UpdaterAdapter } from "./platform.js";

export interface UpdateDriverInfo {
  version: string;
  releaseNotes?: string | Array<{ note?: string | null }> | null;
}

export interface UpdateDriver {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: "checking-for-update", listener: () => void): unknown;
  on(event: "update-available", listener: (info: UpdateDriverInfo) => void): unknown;
  on(event: "update-not-available", listener: () => void): unknown;
  on(event: "download-progress", listener: (progress: { percent?: number }) => void): unknown;
  on(event: "update-downloaded", listener: (info: UpdateDriverInfo) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

function formatReleaseNotes(notes: UpdateDriverInfo["releaseNotes"]): string | undefined {
  if (typeof notes === "string") {
    const trimmed = notes.trim();
    return trimmed || undefined;
  }
  if (Array.isArray(notes)) {
    const joined = notes
      .map((item) => (typeof item?.note === "string" ? item.note.trim() : ""))
      .filter(Boolean)
      .join("\n");
    return joined || undefined;
  }
  return undefined;
}

export function createUpdaterAdapter(
  version: string,
  driver: UpdateDriver,
  emit: (event: DesktopEvent) => void,
): UpdaterAdapter {
  driver.autoDownload = false;
  driver.autoInstallOnAppQuit = true;

  let current: UpdateStatus = { state: "idle", version };
  let lastPercent = -1;

  const setStatus = (next: UpdateStatus) => {
    current = next;
    emit({ kind: "updates", status: next });
  };

  driver.on("checking-for-update", () => {
    setStatus({ state: "checking", version });
  });

  driver.on("update-available", (info) => {
    const notes = formatReleaseNotes(info.releaseNotes);
    setStatus({
      state: "available",
      version,
      next: info.version,
      ...(notes ? { notes } : {}),
    });
  });

  driver.on("update-not-available", () => {
    setStatus({ state: "latest", version });
  });

  driver.on("download-progress", (progress) => {
    const pct = Math.max(0, Math.min(100, Math.round(progress.percent ?? 0)));
    if (pct === lastPercent && current.state === "downloading") return;
    lastPercent = pct;
    const next =
      current.state === "available" || current.state === "downloading" ? current.next : "";
    const notes =
      current.state === "available" || current.state === "downloading" ? current.notes : undefined;
    setStatus({
      state: "downloading",
      version,
      next,
      ...(notes ? { notes } : {}),
      percent: pct,
    });
  });

  driver.on("update-downloaded", (info) => {
    lastPercent = 100;
    const notes = formatReleaseNotes(info.releaseNotes);
    setStatus({
      state: "ready",
      version,
      next: info.version,
      ...(notes ? { notes } : {}),
      percent: 100,
    });
  });

  driver.on("error", (error) => {
    const appErr = classify(error);
    setStatus({ state: "error", version, code: appErr.code, message: appErr.message });
  });

  return {
    async handle(action: UpdateAction): Promise<UpdateStatus> {
      if (action === "status") return current;
      if (action === "check") {
        if (current.state === "checking" || current.state === "downloading") return current;
        setStatus({ state: "checking", version });
        try {
          await driver.checkForUpdates();
        } catch (err) {
          const appErr = classify(err);
          setStatus({ state: "error", version, code: appErr.code, message: appErr.message });
        }
        return current;
      }
      if (action === "download") {
        if (current.state !== "available") return current;
        lastPercent = 0;
        setStatus({
          state: "downloading",
          version,
          next: current.next,
          ...(current.notes ? { notes: current.notes } : {}),
          percent: 0,
        });
        try {
          await driver.downloadUpdate();
        } catch (err) {
          const appErr = classify(err);
          setStatus({ state: "error", version, code: appErr.code, message: appErr.message });
        }
        return current;
      }
      if (action === "install") {
        if (current.state === "ready") {
          setImmediate(() => driver.quitAndInstall(false, true));
        }
        return current;
      }
      return current;
    },
  };
}

export async function createElectronUpdater(
  version: string,
  emit: (event: DesktopEvent) => void,
): Promise<UpdaterAdapter> {
  // The CommonJS entry exposes autoUpdater through a lazy getter on module.exports.
  const { default: updater } = await import("electron-updater");
  const driver: UpdateDriver = updater.autoUpdater;
  return createUpdaterAdapter(version, driver, emit);
}
