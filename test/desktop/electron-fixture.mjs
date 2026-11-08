// The OS boundary is inert in Node; session/storage behavior remains real.
export const app = { isPackaged: false };
// Dialog answers are set per test; a missing answer fails loudly instead of guessing.
export const dialog = {};
export const shell = {};
export class BrowserWindow {}
export class Notification {
  static isSupported() {
    return false;
  }
}
// IPC registrations land in a map so tests call the production handlers directly.
export const ipcMain = {
  handlers: new Map(),
  handle(channel, listener) {
    this.handlers.set(channel, listener);
  },
};
