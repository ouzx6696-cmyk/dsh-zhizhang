import path from "node:path";
import { dialog, shell } from "electron";
import { LibraryPort } from "../../../../../packages/fanqie/src/engine/ports/library";
import { resolveFanqiePaths } from "../storage";
import type { Runtime } from "../runtime";
import { ipcHandler } from "./handle";

export function registerLibraryIpc(state: Runtime) {
  const handle = ipcHandler(state);
  handle("library-storage", async (action) => {
    const target =
      state.target?.mode === "fanqie"
        ? state.target
        : state.settings.workspace
          ? { mode: "fanqie" as const, root: path.join(state.settings.workspace, ".writer") }
          : undefined;
    if (!target) throw new Error("请先选择长篇项目或统一写作根");
    const paths = await resolveFanqiePaths(state.writerConfig, target);
    const location = { root: paths.library, sourceRoot: paths.sourceRoot };
    if (action === "status") return location;
    if (state.maintenance) throw new Error("正在恢复作品，请稍后操作拆书库");
    if (action === "open") {
      await LibraryPort.ensureLibrary(paths);
      const error = await shell.openPath(paths.library);
      if (error) throw new Error(error);
      return location;
    }
    const result = await dialog.showOpenDialog(state.windowOrThrow(), {
      title: "导入小说原文到拆书库",
      properties: ["openFile"],
      filters: [{ name: "小说文本", extensions: ["txt", "md"] }],
    });
    if (result.canceled) return location;
    const file = result.filePaths[0];
    const title = path.basename(file, path.extname(file));
    const imported = await LibraryPort.importSource(paths, { title, file });
    state.emit({ refresh: true });
    return { ...location, imported: { id: imported.sourceId, title } };
  });
}
