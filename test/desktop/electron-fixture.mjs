import { unwrapIpcReply } from "../../apps/desktop/src/ipc-result";
import { EventEmitter } from "node:events";
import path from "node:path";
// The OS boundary is inert in Node; session/storage behavior remains real.
// Lifecycle listeners land on a real emitter so tests fire Electron's quit events in order;
// quit() only records the call.
export const app = Object.assign(new EventEmitter(), {
  isPackaged: false,
  quits: 0,
  quit() {
    this.quits++;
  },
  getPath(name) {
    return path.join(process.cwd(), name);
  },
});
// Dialog answers are set per test (e.g. dialog.showMessageBoxSync = () => 1); a missing answer fails loudly instead of guessing.
export const dialog = {};
export const shell = {};
export class BrowserWindow {}
export class Notification {
  static isSupported() {
    return false;
  }
}
// IPC registrations land in a map so tests call the production handlers directly.
const ipcListeners = new Map();
export const ipcMain = {
  handlers: new Map(),
  async invoke(channel, ...args) {
    const reply = await Promise.resolve()
      .then(() => ipcListeners.get(channel)(...args))
      .catch((error) => {
        throw new Error(error.message);
      });
    return structuredClone(reply);
  },
  handle(channel, listener) {
    ipcListeners.set(channel, listener);
    this.handlers.set(channel, (...args) => this.invoke(channel, ...args).then(unwrapIpcReply));
  },
};
