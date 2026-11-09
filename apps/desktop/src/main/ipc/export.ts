import { dialog, clipboard } from "electron";
import { writeFile } from "node:fs/promises";
import type { Runtime } from "../runtime";
import { ipcHandler } from "./handle";
import { exportContent, wordDocument } from "../../exports";

export function registerExportIpc(state: Runtime) {
  const handle = ipcHandler(state);
  handle("export", async (target, focus, format) => {
    const next = target;
    const content = await exportContent(next, focus, state.writerConfig);
    const answer = await dialog.showMessageBox(state.windowOrThrow(), {
      type: content.issues.length ? "warning" : "info",
      title: "导出与发布检查",
      message: [...content.issues, content.reminder].join("\n"),
      buttons: ["取消", format === "copy" ? "复制标题与正文" : "导出"],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return null;
    if (format === "copy") {
      await clipboard.writeText(content.text);
      return { copied: true as const };
    }
    const extension = format === "docx" ? "docx" : "txt",
      result = await dialog.showSaveDialog(state.windowOrThrow(), {
        title: "导出稿件",
        defaultPath: content.title.replace(/[<>:"/\\|?*]/g, "_") + "." + extension,
        filters: [{ name: extension, extensions: [extension] }],
      });
    if (result.canceled || !result.filePath) return null;
    await writeFile(
      result.filePath,
      extension === "docx" ? await wordDocument(content.title, content.text) : content.text,
    );
    return { file: result.filePath };
  });
}
