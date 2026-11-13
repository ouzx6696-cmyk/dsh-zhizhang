import { app, dialog, type BrowserWindow } from "electron";
import { errorText } from "../../../../packages/core/src/errors";
import { releaseWorkspaces } from "../../../../packages/core/src/workspace-lock";
import { UNLOAD_COPY } from "@writer/ui/copy";
import type { Runtime } from "./runtime";

/**
 * The renderer vetoes unloading while text is unsaved; without this listener Electron cancels the
 * close silently and the author's × does nothing. The author decides here instead.
 */
export function guardUnload(window: BrowserWindow) {
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
 * Sessions and workspace claims are released only in will-quit: it fires after every window has
 * agreed to close, so a quit the author cancels leaves the app fully working.
 */
export function registerQuitCleanup(state: Runtime) {
  let cleaned = false;
  app.on("will-quit", (event) => {
    if (cleaned) return;
    event.preventDefault();
    void releaseOnQuit(state).finally(() => {
      cleaned = true;
      app.quit();
    });
  });
}

const QUIT_STEPS: [string, (state: Runtime) => Promise<void>][] = [
  [
    "background",
    async (state) => {
      state.background.abort();
    },
  ],
  ["sessions", (state) => state.sessions.dispose()],
  ["workspaces", () => releaseWorkspaces()],
];

/** A failed step is logged and the next one still runs, so one failure never blocks quitting. */
async function releaseOnQuit(state: Runtime) {
  for (const [step, run] of QUIT_STEPS) {
    try {
      await run(state);
    } catch (error) {
      await state.diagnostics.write("quit_cleanup_failed", { step, error: errorText(error) });
    }
  }
}
