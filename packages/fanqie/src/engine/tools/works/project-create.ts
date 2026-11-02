import { createWork } from "../../work-store.js";
import { ensureStorage } from "../../storage/paths.js";

import { Scheduler } from "../../ports/index.js";

import { asString, config, rememberWork } from "../context.js";

import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const projectCreate = defineTool({
  name: "fanqie_project_create",
  description:
    "创建长篇作品目录。默认写作链：chapter_brief(lean)→stage→accept（内置扫描）。不生成正文。",
  properties: {
    title: S("作品标题（必填）"),
    genre: S("可选类型"),
    premise: S("可选一句话前提"),
    key: S("可选目录名 slug；默认由标题生成"),
    working_dir: WORKING_DIR,
  },
  required: ["title"],
  async execute(args, exec) {
    const title = asString(args, "title", { required: true });
    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
    const { meta, dir } = await createWork(paths, {
      title,
      genre: asString(args, "genre"),
      premise: asString(args, "premise"),
      key: asString(args, "key"),
    });
    rememberWork(exec, meta.key);
    exec.onWorkCreated?.(paths.base, meta.key);
    return [
      `已创建作品「${meta.title}」（key=${meta.key}）`,
      `- 目录：${dir}`,
      `- 根基/章纲/正文均落本地；AI 不得自动写库`,
      "",
      `默认下一步：${Scheduler.nextHint("project_create")}`,
      "旁路（非默认）：diagnose.audit · finalize.ship · save.direct — 见 fanqie_product_map",
    ].join("\n");
  },
});
