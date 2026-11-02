import { LibraryPort } from "../../ports/index.js";

import { asString, asStringArray } from "../context.js";
import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryComboSuggest = defineTool({
  name: "fanqie_library_combo_suggest",
  description:
    "【闭环·库 9/9 组包】推荐 1 book + N scene（可跨书）card_ids。下一步：inspire_start(card_ids) 或 chapter_brief(card_ids)。",
  properties: {
    source_ids: {
      type: "array",
      description: "限制候选池到来源（可多本；空=全库）",
      items: { type: "string" },
    },
    source_title: S("书名/作者子串限制候选池"),
    craft_count: {
      type: "integer",
      description: "技法张数 N（默认 2，1–8）",
    },
    query: S("主题检索，给 mind/craft 排序"),
    prefer_mind_source: S("优先从该 sourceId 抽 mind"),
    working_dir: WORKING_DIR,
  },
  required: [],
  async execute(args, exec) {
    const paths = await openLibrary(exec, args, false);
    const sourceIds = asStringArray(args, "source_ids");
    const prefer = asString(args, "prefer_mind_source");
    const craftCount = typeof args.craft_count === "number" ? args.craft_count : undefined;
    const queryText = asString(args, "query");
    const result = await LibraryPort.suggestCombo(paths, {
      sourceIds,
      sourceTitle: asString(args, "source_title"),
      craftCount,
      query: asString(args, "query"),
      preferMindSourceIds: prefer ? [prefer] : undefined,
    });
    if (!result.ok) {
      return [
        "当前没有可用参考卡",
        `- 原因：${result.emptyReason ?? "未知"}`,
        "",
        "可放宽来源过滤，或直接按作者目标规划；不要求先补参考卡",
      ].join("\n");
    }
    const lines = [
      "参考组合（优先 mind + craft，缺一轴不阻断）",
      `- card_ids：${result.cardIds.join(", ")}`,
      result.mind
        ? `- mind：${result.mind.title}（${result.mind.id}）· src=${result.mind.sourceId}`
        : "- mind：无；可按作者材料规划，不强制补卡",
      ...(queryText ? [`- 主题排序：${queryText}`] : []),
      `- craft ×${result.crafts.length}：`,
      ...result.crafts.map(
        (c, i: number) => `  ${i + 1}. ${c.title}（${c.id}）· src=${c.sourceId}`,
      ),
      "",
      "用法：fanqie_inspire_start(card_ids=[...]) 或 fanqie_chapter_brief(card_ids=[...])",
      "说明：inspire/forge 吃全包（mind 主粮）；lean chapter_brief 只吃其中 craft。",
    ];
    if (result.warnings.length) {
      lines.push("", "【提示】");
      for (const w of result.warnings) lines.push(`- ${w}`);
    }
    return lines.join("\n");
  },
});
