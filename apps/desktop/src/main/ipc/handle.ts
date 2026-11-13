import { ipcMain, type IpcMainInvokeEvent } from "electron";
import { ipcFailure } from "../../ipc-result";
import { IPC_PARSERS } from "./contract";
import type { IpcArgs, IpcChannel, IpcResult } from "./contract";
import type { Runtime } from "../runtime";

/** 只认主窗口主帧：子帧或别的 webContents（例如被注入的页面）即便拿到 ipcRenderer 也调不动主进程。 */
function fromMainFrame(state: Runtime, event: IpcMainInvokeEvent) {
  const window = state.window;
  return (
    window !== undefined &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame
  );
}

/** One registration path for every channel; the contract is the only name list. */
export function ipcHandler(state: Runtime) {
  return function handle<K extends IpcChannel>(
    channel: K,
    listener: (...args: IpcArgs<K>) => IpcResult<K> | Promise<IpcResult<K>>,
  ) {
    ipcMain.handle("writer:" + channel, async (event, ...args: unknown[]) => {
      try {
        if (!fromMainFrame(state, event)) throw new Error(`拒绝非主窗口发来的调用：${channel}`);
        return { ok: true, value: await listener(...IPC_PARSERS[channel](args)) };
      } catch (error) {
        return ipcFailure(error);
      }
    });
  };
}
