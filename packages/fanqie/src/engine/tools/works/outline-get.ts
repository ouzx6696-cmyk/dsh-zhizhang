import { readChapter } from "../../storage/chapters.js";

import { asString, openWork } from "../context.js";
import { renderOutline } from "../render.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const outlineGet = defineTool({
  name: "fanqie_outline_get",
  description: "读取某章章纲（含 situationLens / livedScene / stateLens）。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id（如 c001）"),
  },
  required: ["chapter"],
  async execute(args, exec) {
    const chapterId = asString(args, "chapter", { required: true });
    const { dir } = await openWork(exec, args);
    const ch = await readChapter(dir, chapterId);
    return [`# 章纲 · ${ch.title}（${ch.id}）`, renderOutline(ch.outline)].join("\n");
  },
});
