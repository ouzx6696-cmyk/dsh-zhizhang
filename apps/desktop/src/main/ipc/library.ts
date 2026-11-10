import { readWorkMeta } from "../../../../../packages/fanqie/src/engine/storage/work-meta";
import {
  setReadingBenchmark,
  setReadingOpening,
} from "../../../../../packages/fanqie/src/engine/services/benchmark";
import { resolveFanqieWork } from "../storage";
import path from "node:path";
import { dialog, shell } from "electron";
import { LibraryPort } from "../../../../../packages/fanqie/src/engine/ports/library";
import { resolveFanqiePaths } from "../storage";
import type { Runtime } from "../runtime";
import { ipcHandler } from "./handle";
import { dialogStartPath } from "./dialogs";

export function registerLibraryIpc(state: Runtime) {
  const handle = ipcHandler(state);
  handle("library-storage", async (action, sourceId, opening) => {
    const target =
      state.target?.mode === "fanqie"
        ? state.target
        : state.settings.workspace
          ? { mode: "fanqie" as const, root: path.join(state.settings.workspace, ".writer") }
          : undefined;
    if (!target) throw new Error("请先选择长篇项目或统一写作根");
    const paths = await resolveFanqiePaths(state.writerConfig, target);
    const dir = target.work ? await resolveFanqieWork(state.writerConfig, target) : undefined;
    const getLocation = async () => {
      const benchmark = dir ? (await readWorkMeta(dir)).readingBenchmark : undefined;
      return {
        root: paths.library,
        canBenchmark: dir !== undefined,
        sourceRoot: paths.sourceRoot,
        sources: (await LibraryPort.listSources(paths)).map((row) => ({
          id: row.id,
          title: row.title,
        })),
        ...(benchmark
          ? {
              benchmark: {
                sourceId: benchmark.sourceId,
                sampledChapters: benchmark.sampledChapters,
                ...(benchmark.opening ? { opening: benchmark.opening } : {}),
              },
            }
          : {}),
      };
    };
    const location = await getLocation();
    if (action === "status") return location;
    if (state.maintenance) throw new Error("正在恢复作品，请稍后操作拆书库");
    if (action === "benchmark" || action === "clear-benchmark" || action === "benchmark-opening") {
      if (!dir || !state.target?.work) throw new Error("请先选择需要设置对标书的长篇项目");
      if (state.sessions.isRunning(state.target)) throw new Error("请等待当前任务结束再调整对标书");
      if (action === "benchmark" && !sourceId) throw new Error("请选择已导入的书源");
      if (action === "benchmark-opening") await setReadingOpening(dir, opening);
      else
        await setReadingBenchmark(
          paths,
          dir,
          action === "benchmark" ? sourceId : undefined,
          state.pythonPath(),
        );
      state.emit({ refresh: true });
      return getLocation();
    }
    if (action === "open") {
      await LibraryPort.ensureLibrary(paths);
      const error = await shell.openPath(paths.library);
      if (error) throw new Error(error);
      return location;
    }
    const result = await dialog.showOpenDialog(state.windowOrThrow(), {
      title: "导入小说原文到拆书库",
      defaultPath: dialogStartPath(state),
      properties: ["openFile"],
      filters: [{ name: "小说文本", extensions: ["txt", "md"] }],
    });
    if (result.canceled) return location;
    const file = result.filePaths[0];
    const title = path.basename(file, path.extname(file));
    const imported = await LibraryPort.importSource(paths, { title, file });
    state.emit({ refresh: true });
    return { ...(await getLocation()), imported: { id: imported.sourceId, title } };
  });
}
