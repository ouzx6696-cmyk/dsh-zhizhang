import { readWorkMeta } from "../../storage/work-meta.js";

import { openWork } from "../context.js";

import { WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const foundationGet = defineTool({
  name: "fanqie_foundation_get",
  description: "读取作品根基（锁定/已发生/人物/读者知情/计划/未结伏笔/文风）。",
  properties: { work: WORK_OPT, working_dir: WORKING_DIR },
  required: [],
  async execute(args, exec) {
    const { dir } = await openWork(exec, args);
    const meta = await readWorkMeta(dir);
    const f = meta.foundation;
    return [
      "## 根基",
      `- 节奏：${meta.pace || "未指定"}`,
      `- locks：${f.locks || "（空）"}`,
      `- happened：${f.happened || "（空）"}`,
      `- characters：${f.characters || "（空）"}`,
      `- readerKnowledge：${f.readerKnowledge || "（空）"}`,
      `- planned：${f.planned || "（空）"}`,
      `- threads：${f.threads || "（空）"}`,
      `- style：${f.style || "（空）"}`,
    ].join("\n");
  },
});
