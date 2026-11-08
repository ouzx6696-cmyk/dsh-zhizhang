export { Runtime } from "../../apps/desktop/src/main/runtime";
export { claimWorkspace, releaseWorkspace } from "../../packages/core/src/workspace-lock";
export { registerModelsIpc } from "../../apps/desktop/src/main/ipc/models";
export { registerBackupIpc } from "../../apps/desktop/src/main/ipc/backup";
export { registerWorkspaceIpc } from "../../apps/desktop/src/main/ipc/workspace";
// The bundle inlines its own electron fixture; tests must read handlers from that same instance.
export { dialog, ipcMain } from "electron";
