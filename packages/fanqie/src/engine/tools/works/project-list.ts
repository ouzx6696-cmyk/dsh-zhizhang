import { ensureStorage } from "../../storage/paths.js";

import { listWorks } from "../../storage/projects.js";

import { asString, config } from "../context.js";

import { WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const projectList = defineTool({
  name: "fanqie_project_list",
  description: "列出存储根下全部长篇作品（key、标题、章节数、字数、更新时间）。",
  properties: { working_dir: WORKING_DIR },
  required: [],
  async execute(args, exec) {
    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
    const rows = await listWorks(paths);
    if (rows.length === 0) return "还没有作品。用 fanqie_project_create 创建第一部。";
    return [
      "作品列表（最近更新在前）：",
      ...rows.map((w, i: number) => {
        if (w.recoveryPending)
          return `${i + 1}. ${w.title}（${w.key}）· 操作待恢复；章节与字数暂不可确认。${w.recoveryHint || "请检查恢复记录。"}`;
        const words = w.chapters.reduce((s, c) => s + c.wordCount, 0);
        return `${i + 1}. ${w.title}（${w.key}）· ${w.chapters.length} 章 · 约 ${words} 字 · ${w.updatedAt}`;
      }),
    ].join("\n");
  },
});
