import { readWorkMeta } from "../../storage/work-meta.js";

import { openWork, rememberWork } from "../context.js";
import { renderStatus } from "../render.js";
import { WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const projectOpen = defineTool({
  name: "fanqie_project_open",
  description: "打开一部作品并记住为本会话当前作品，返回状态摘要。",
  properties: { work: WORK_OPT, working_dir: WORKING_DIR },
  required: [],
  async execute(args, exec) {
    const { dir, key, paths } = await openWork(exec, { ...args, work: args.work ?? args.project });
    const meta = await readWorkMeta(dir);
    rememberWork(exec, key);
    return renderStatus(meta, dir, paths);
  },
});
