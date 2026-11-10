import { parsePursuitOutline } from "../../domain/pursuit.js";
import { setOutline } from "../../storage/chapters.js";

import { asString, fail, openWork } from "../context.js";
import { renderOutline } from "../render.js";
import { OUTLINE_PROPS, PURSUIT_PROPS, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const outlineSet = defineTool({
  name: "fanqie_outline_set",
  description:
    "写入/合并某章章纲。写前定调：处境透镜、亲历重心、状态透镜。续写章接着前章后果换压力。不生成正文。若章节不存在则创建空章。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id；不存在则新建"),
    title: S("可选章节标题（新建或改名）"),
    ...OUTLINE_PROPS,
  },
  required: ["chapter"],
  async execute(args, exec) {
    const chapterId = asString(args, "chapter", { required: true });
    const { dir } = await openWork(exec, args);
    const patch: Record<string, unknown> = { ...parsePursuitOutline(args) };
    for (const key of Object.keys(OUTLINE_PROPS)) {
      if (key in PURSUIT_PROPS) continue;
      if (args[key] === undefined || args[key] === null) continue;
      if (key === "targetWords") {
        if (
          typeof args.targetWords !== "number" ||
          !Number.isInteger(args.targetWords) ||
          args.targetWords <= 0
        )
          fail("targetWords 必须是正整数");
        patch.targetWords = args.targetWords;
      } else {
        const v = asString(args, key);
        if (v !== undefined) patch[key] = v;
      }
    }
    const saved = await setOutline(dir, chapterId, patch, asString(args, "title"));
    return [`已写入章纲「${saved.title}」`, renderOutline(saved.outline)].join("\n");
  },
});
