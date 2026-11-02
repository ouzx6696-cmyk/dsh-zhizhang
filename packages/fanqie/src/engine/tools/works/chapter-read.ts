import { readChapter } from "../../storage/chapters.js";

import { asString, openWork } from "../context.js";
import { renderOutline } from "../render.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const chapterRead = defineTool({
  name: "fanqie_chapter_read",
  description: "读取某章正文与章纲。续写或审校前先取现场。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id"),
  },
  required: ["chapter"],
  async execute(args, exec) {
    const chapterId = asString(args, "chapter", { required: true });
    const { dir } = await openWork(exec, args);
    const ch = await readChapter(dir, chapterId);
    return [
      `# ${ch.title}（${ch.id}）`,
      `- 修订：${ch.revision}`,
      `- 审读声明：${ch.review ? `${ch.review.result} · ${ch.review.revision === ch.revision ? "正文版本匹配（依据仍须复核）" : "旧正文版本，已过期"} · ${ch.review.summary}` : "未记录；旧定稿不补造证据"}`,
      `- 条件依赖：${JSON.stringify(ch.dependencies ?? [])}`,
      `- 状态：${ch.status} · ${ch.wordCount} 字 · ${ch.updatedAt}`,
      "",
      "## 章纲",
      renderOutline(ch.outline),
      "",
      "## 正文",
      ch.body.trim() ? ch.body : "（空稿）",
    ].join("\n");
  },
});
