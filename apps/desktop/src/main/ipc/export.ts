import { dialog, clipboard } from "electron";
import { writeFile } from "node:fs/promises";
import type { Runtime } from "../runtime";
import { handle } from "./handle";
import { parseFocus, parseTarget } from "./validate";
import { exportContent, wordDocument } from "../../exports";

export function registerExportIpc(state: Runtime) {
  handle("export", async (target, focus, format) => {
    const next = parseTarget(target);
    const content = await exportContent(next, parseFocus(focus));
    const answer = await dialog.showMessageBox(state.window!, {
      type: content.issues.length ? "warning" : "info",
      title: "导出与发布检查",
      message: [...content.issues, content.reminder].join("\n"),
      buttons: ["取消", format === "copy" ? "复制标题与正文" : "导出"],
      defaultId: 0,
      cancelId: 0,
    });
    if (answer.response !== 1) return null;
    if (format === "copy") {
      clipboard.writeText(content.text);
      return { copied: true as const };
    }
    const extension = format === "docx" ? "docx" : "txt",
      result = await dialog.showSaveDialog(state.window!, {
        title: "导出稿件",
        defaultPath: content.title.replace(/[<>:"/\\|?*]/g, "_") + "." + extension,
        filters: [{ name: extension, extensions: [extension] }],
      });
    if (result.canceled || !result.filePath) return null;
    await writeFile(
      result.filePath,
      extension === "docx"
        ? await wordDocument(content.title, content.text)
        : content.text,
    );
    return { file: result.filePath };
  });
}
