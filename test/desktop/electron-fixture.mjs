// The OS boundary is inert in Node; session/storage behavior remains real.
export const app = { isPackaged: false };
export const dialog = {};
export class BrowserWindow {}
export class Notification {
  static isSupported() { return false; }
}
