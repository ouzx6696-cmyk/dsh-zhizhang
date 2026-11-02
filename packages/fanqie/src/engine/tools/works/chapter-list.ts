import { listChapters } from "../../storage/chapters.js";

import { openWork } from "../context.js";

import { WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const chapterList = defineTool({
  name: "fanqie_chapter_list",
  description: "列出作品章节清单（id、标题、状态、字数）。",
  properties: { work: WORK_OPT, working_dir: WORKING_DIR },
  required: [],
  async execute(args, exec) {
    const { dir } = await openWork(exec, args);
    const rows = await listChapters(dir);
    if (rows.length === 0) return "尚无章节。用 fanqie_outline_set 或 fanqie_chapter_save 创建。";
    return rows
      .map((c) => `${c.position}. [${c.status}] ${c.title}（${c.id}，${c.wordCount} 字）`)
      .join("\n");
  },
});
