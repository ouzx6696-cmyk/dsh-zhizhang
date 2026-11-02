import { LibraryPort } from "../../ports/index.js";

import { AUTO_SAMPLE_RATIO } from "../../domain/workflow.js";
import { asString } from "../context.js";
import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary, resolveBookFile } from "./context.js";
export const libraryImport = defineTool({
  name: "fanqie_library_import",
  description:
    "【闭环·库 1/9 交书】导入小说原文到拆书库。传 text 或 file（file 可写本地书源目录里的文件名）。不拆书、不写卡。下一步 2/9：library_plan（Auto 10% / Full 须同意）。",
  properties: {
    title: S("书名（必填）"),
    author: S("可选作者"),
    text: S("原文全文（与 file 二选一）"),
    file: S("原文文件路径（相对 cwd / 本地书源 / 绝对路径；与 text 二选一）"),
    reading_range: S("可选：实际阅读范围说明"),
    working_dir: WORKING_DIR,
  },
  required: ["title"],
  async execute(args, exec) {
    const title = asString(args, "title", { required: true });
    const paths = await openLibrary(exec, args, true);
    const fileResolved = await resolveBookFile(paths, exec, asString(args, "file"));
    const result = await LibraryPort.importSource(paths, {
      title,
      author: asString(args, "author"),
      text: asString(args, "text", { trim: false }),
      file: fileResolved,
      readingRange: asString(args, "reading_range"),
    });
    return [
      `已导入「${title}」→ sourceId=${result.sourceId}`,
      `- 字数：${result.charCount}`,
      `- 正文：library/sources/${result.excerptPath}`,
      `- 编码：${result.encoding ?? "utf-8"}${result.converted ? "（已转换）" : ""}`,
      ...(result.warning ? [`- 注意：${result.warning}`] : []),
      "",
      `下一步 2/9：fanqie_library_plan(mode=auto|full) 建抽样计划；Auto 默认 ${Math.round(AUTO_SAMPLE_RATIO * 100)}%`,
    ].join("\n");
  },
});
