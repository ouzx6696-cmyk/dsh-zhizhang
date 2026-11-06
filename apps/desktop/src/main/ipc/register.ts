import { registerLibraryIpc } from "./library";
import type { Runtime } from "../runtime";
import { registerWorkspaceIpc } from "./workspace";
import { registerModelsIpc } from "./models";
import { registerSessionIpc } from "./session";
import { registerExportIpc } from "./export";
import { registerBackupIpc } from "./backup";
import { registerUpdatesIpc } from "./updates";
import { registerDiagnosticsIpc } from "./diagnostics";

export function registerIpc(state: Runtime) {
  registerWorkspaceIpc(state);
  registerLibraryIpc(state);
  registerModelsIpc(state);
  registerSessionIpc(state);
  registerExportIpc(state);
  registerBackupIpc(state);
  registerUpdatesIpc(state);
  registerDiagnosticsIpc(state);
}
