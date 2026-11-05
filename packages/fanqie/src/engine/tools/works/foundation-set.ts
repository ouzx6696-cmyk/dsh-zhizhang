import { setFoundation } from "../../work-store.js";

import { asString, fail, openWork } from "../context.js";

import { E, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const foundationSet = defineTool({
  name: "fanqie_foundation_set",
  description: "部分更新作品根基字段。只改传入的键。定稿后可用它追加 happened / threads。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    locks: S("作者锁定"),
    happened: S("已发生事实"),
    characters: S("人物卡摘要"),
    readerKnowledge: S("读者已知"),
    planned: S("计划中未发生"),
    threads: S("未结伏笔"),
    style: S("全书文风约束"),
    pace: E(["快爽", "稳推", "慢燃"], "可选：本书节奏档位"),
  },
  required: [],
  async execute(args, exec) {
    const { dir } = await openWork(exec, args);
    const patch: Record<string, unknown> = {};
    for (const key of [
      "locks",
      "happened",
      "characters",
      "readerKnowledge",
      "planned",
      "threads",
      "style",
    ]) {
      const v = asString(args, key);
      if (v !== undefined) patch[key] = v;
    }
    const pace = asString(args, "pace");
    if (Object.keys(patch).length === 0 && !pace) fail("至少提供一个根基字段或节奏");
    const meta = await setFoundation(dir, patch, { pace });
    return `已更新「${meta.title}」根基：${[...Object.keys(patch), ...(pace ? ["pace"] : [])].join("、")}`;
  },
});
