import { app, dialog, type BrowserWindow } from "electron";
import { UNLOAD_COPY } from "../shared/copy.js";

/**
 * 渲染层在有未保存内容时会否决卸载；没有这个监听，Electron 会静默取消关闭，作者点 × 毫无反应。
 * 这里交给作者决定。
 */
export function guardUnload(window: BrowserWindow): void {
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question",
      title: UNLOAD_COPY.title,
      message: UNLOAD_COPY.message,
      detail: UNLOAD_COPY.detail,
      buttons: [UNLOAD_COPY.stay, UNLOAD_COPY.leave],
      defaultId: 0,
      cancelId: 0,
    });
    if (choice === 1) event.preventDefault();
  });
}

/**
 * 退出清理只在 will-quit 里做：此时所有窗口都已同意关闭，作者取消退出时应用保持完整可用。
 * 每一步失败只记诊断，下一步照常执行，任何一步都不会卡住退出。
 */
export function registerQuitCleanup(
  steps: Array<[string, () => Promise<void> | void]>,
  onFailure: (step: string, error: unknown) => void,
): void {
  let cleaned = false;
  app.on("will-quit", (event) => {
    if (cleaned) return;
    event.preventDefault();
    void (async () => {
      for (const [step, run] of steps) {
        try {
          await run();
        } catch (error) {
          onFailure(step, error);
        }
      }
    })().finally(() => {
      cleaned = true;
      app.quit();
    });
  });
}
