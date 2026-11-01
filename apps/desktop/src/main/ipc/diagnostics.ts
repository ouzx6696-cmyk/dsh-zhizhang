import { dialog } from "electron";
import { writeFile } from "node:fs/promises";
import type { Runtime } from "../runtime";
import { handle } from "./handle";
import { VERSION } from "../../../../../packages/core/src/version";

export function registerDiagnosticsIpc(state: Runtime) {
  handle("diagnostics", async () => {
    const result = await dialog.showSaveDialog(state.window!, {
      title: "导出诊断包",
      defaultPath: "写作Agent-诊断.json",
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(
      result.filePath,
      JSON.stringify(
        await state.diagnostics.bundle({
          version: VERSION,
          settings: state.settings.public(),
          writerConfig: state.writerConfig,
        }),
        null,
        2,
      ),
    );
    return { file: result.filePath };
  });
}
