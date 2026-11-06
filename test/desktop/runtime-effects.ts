export { Runtime } from "../../apps/desktop/src/main/runtime";
export { claimWorkspace, releaseWorkspace } from "../../packages/core/src/workspace-lock";
export { registerModelsIpc } from "../../apps/desktop/src/main/ipc/models";
// The bundle inlines its own electron fixture; tests must read handlers from that same instance.
export { ipcMain } from "electron";
