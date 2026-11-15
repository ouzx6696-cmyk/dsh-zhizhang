import { dialog, ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { AppError, classify, isAppError, serializeError } from "@zhizhang/core/errors";
import type { WorkbenchCommand } from "@zhizhang/workbench/contract";
import { dispatchWorkbenchCommand } from "../commands.js";
import type { WorkflowService } from "../workflow.js";
import type { IpcChannel, IpcMap, Reply, WorkspaceStatus } from "../../shared/ipc.js";
import { parseSettings, type AppSettings } from "../../shared/settings.js";

const WRITE_COMMANDS = new Set<WorkbenchCommand>([
  "fanqie.chapter.save",
  "fanqie.chapter.finalize",
  "fanqie.candidate.accept",
  "fanqie.work.create",
  "toutiao.article.create",
  "toutiao.article.transition",
  "toutiao.article.deliver",
]);

function fromMainFrame(window: BrowserWindow | undefined, event: IpcMainInvokeEvent): boolean {
  return (
    window !== undefined &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame
  );
}

function toReplyError<T>(error: unknown): Reply<T> {
  const appErr = isAppError(error) ? error : classify(error);
  const serialized = serializeError(appErr);
  return {
    ok: false,
    error: {
      code: serialized.code,
      message: serialized.message,
      ...(serialized.data !== undefined ? { data: serialized.data } : {}),
    },
  };
}

export interface RegisterIpcDeps {
  getWindow: () => BrowserWindow | undefined;
  workflow: WorkflowService;
  getSettings: () => Promise<AppSettings> | AppSettings;
  saveSettings: (next: AppSettings) => Promise<void>;
  getWorkspaceStatus: () => WorkspaceStatus;
  getAppInfo: () => { version: string; userData: string };
}

export function registerIpc(deps: RegisterIpcDeps): void {
  function assertWritable() {
    const status = deps.getWorkspaceStatus();
    if (status.readonly) {
      throw new AppError(
        "storage.locked",
        "写作文件夹已被另一个织章实例打开，当前处于只读降级模式",
        { readonly: true, owner: status.owner },
      );
    }
  }

  function handle<K extends IpcChannel>(
    channel: K,
    listener: (...args: IpcMap[K]["args"]) => Promise<IpcMap[K]["result"]> | IpcMap[K]["result"],
  ) {
    ipcMain.removeHandler(`zhizhang:${channel}`);
    ipcMain.handle(
      `zhizhang:${channel}`,
      async (event, ...args: unknown[]): Promise<Reply<IpcMap[K]["result"]>> => {
        try {
          if (!fromMainFrame(deps.getWindow(), event)) {
            throw new AppError("input.unauthorized", `拒绝非主窗口发来的调用：${channel}`);
          }
          const value = await listener(...(args as IpcMap[K]["args"]));
          return { ok: true, value };
        } catch (error) {
          return toReplyError(error);
        }
      },
    );
  }

  handle("workbench.call", async ({ command, input }) => {
    if (WRITE_COMMANDS.has(command)) assertWritable();
    return dispatchWorkbenchCommand(command, input);
  });

  handle("workflow.start", async (target, payload) => {
    assertWritable();
    const rec = await deps.workflow.start(target, payload.kind, payload.request);
    return { runId: rec.id, target };
  });

  handle("workflow.control", async (ref, action) => {
    await deps.workflow.control(ref, action);
  });

  handle("settings.get", async () => {
    return deps.getSettings();
  });

  handle("settings.save", async (raw) => {
    const parsed = parseSettings(raw);
    await deps.saveSettings(parsed);
  });

  handle("workspace.status", () => {
    return deps.getWorkspaceStatus();
  });

  handle("workspace.pick", async (options) => {
    const win = deps.getWindow();
    const result = await dialog.showOpenDialog(
      ...(win ? ([win] as const) : ([] as const)),
      {
        title: options?.title ?? "选择写作文件夹",
        defaultPath: options?.defaultPath,
        properties: ["openDirectory", "createDirectory"],
      },
    );
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  handle("dialog.saveFile", async (options) => {
    const win = deps.getWindow();
    const result = await dialog.showSaveDialog(
      ...(win ? ([win] as const) : ([] as const)),
      {
        title: options?.title ?? "导出文件",
        defaultPath: options?.defaultPath,
        filters: options?.filters,
      },
    );
    return result.canceled ? null : (result.filePath ?? null);
  });

  handle("app.info", () => {
    return deps.getAppInfo();
  });
}
