/**
 * Electron IPC 适配器：把共享 RPC 分发器挂载到 ipcMain（"zhizhang:<channel>"），
 * 并强制校验调用来自主窗口主帧。
 */
import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { AppError, serializeError } from "@zhizhang/core/errors";
import type { IpcChannel, IpcResult, Reply } from "../../shared/ipc.js";
import { createRpcHandlers, type MainServices } from "./handlers.js";

export type { MainServices } from "./handlers.js";

function fromMainFrame(window: BrowserWindow | undefined, event: IpcMainInvokeEvent): boolean {
  return (
    window !== undefined &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame
  );
}

export function registerIpc(s: MainServices, getWindow: () => BrowserWindow | undefined): void {
  const rpc = createRpcHandlers(s);

  for (const channel of rpc.channels) {
    registerChannel(channel);
  }

  function registerChannel<K extends IpcChannel>(channel: K): void {
    ipcMain.removeHandler(`zhizhang:${channel}`);
    ipcMain.handle(
      `zhizhang:${channel}`,
      async (event, ...raw: unknown[]): Promise<Reply<IpcResult<K>>> => {
        if (!fromMainFrame(getWindow(), event)) {
          const serialized = serializeError(
            new AppError("ipc.invalid_args", `拒绝非主窗口发来的调用：${channel}`, { channel }),
          );
          return {
            ok: false,
            error: {
              code: serialized.code,
              message: serialized.message,
              ...(serialized.data !== undefined ? { data: serialized.data } : {}),
            },
          };
        }
        return rpc.invoke(channel, raw);
      },
    );
  }
}
