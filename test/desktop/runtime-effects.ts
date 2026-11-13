export { Runtime } from "../../apps/desktop/src/main/runtime";
export { claimWorkspace, releaseWorkspace } from "../../packages/core/src/workspace-lock";
export { registerModelsIpc } from "../../apps/desktop/src/main/ipc/models";
export { rememberProject } from "../../packages/fanqie/src/engine/storage/projects";
export { registerBackupIpc } from "../../apps/desktop/src/main/ipc/backup";
export { runBackup } from "../../apps/desktop/src/main/backup-process";
export { registerWorkspaceIpc } from "../../apps/desktop/src/main/ipc/workspace";
export { registerSessionIpc } from "../../apps/desktop/src/main/ipc/session";
// The bundle inlines its own electron fixture; tests must read handlers from that same instance.
export { app, dialog, ipcMain } from "electron";
export { guardUnload, registerQuitCleanup } from "../../apps/desktop/src/main/exit";
