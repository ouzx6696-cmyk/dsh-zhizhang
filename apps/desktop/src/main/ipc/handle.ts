import { ipcMain } from "electron";
import type { IpcArgs, IpcChannel, IpcResult } from "./contract";

/** One registration path for every channel; the contract is the only name list. */
export function handle<K extends IpcChannel>(
  channel: K,
  listener: (...args: IpcArgs<K>) => IpcResult<K> | Promise<IpcResult<K>>,
) {
  ipcMain.handle("writer:" + channel, (_event, ...args) =>
    listener(...(args as IpcArgs<K>)),
  );
}
