import { LibraryPort } from "../../ports/index.js";

import { asString, asStringArray } from "../context.js";
import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const librarySearch = defineTool({
  name: "fanqie_library_search",
  description:
    "【闭环·库·辅助】检索已采纳卡（可按书/轴/标签；query 多词=同时满足）。组包走 9/9 combo_suggest。",
  properties: {
    query: S("检索词（与过滤二选一或并用；仅过滤时可空）"),
    source: S("按单本 sourceId"),
    source_ids: {
      type: "array",
      description: "按多本 sourceId",
      items: { type: "string" },
    },
    source_title: S("按书名/作者子串"),
    axis: S("craft | mind"),
    tag: S("按标签精确过滤（如 战斗 / 都市高武 / 信息投放）"),
    working_dir: WORKING_DIR,
  },
  required: [],
  async execute(args, exec) {
    const query = asString(args, "query") ?? "";
    const paths = await openLibrary(exec, args, false);
    const sourceIds = asStringArray(args, "source_ids");
    const axisRaw = asString(args, "axis");
    const axis = axisRaw === "craft" ? "craft" : axisRaw === "mind" ? "mind" : undefined;
    const hits = await LibraryPort.searchCards(paths, query, {
      sourceId: asString(args, "source"),
      sourceIds,
      sourceTitle: asString(args, "source_title"),
      axis,
      tag: asString(args, "tag"),
    });
    const tagArg = asString(args, "tag");
    const label = query || (tagArg ? `tag=${tagArg}` : "(仅过滤)");
    if (hits.length === 0) return `无命中：「${label}」`;
    return [
      `检索「${label}」· ${hits.length} 条：`,
      ...hits.map(
        (c, i: number) =>
          `${i + 1}. ${c.title}（${c.id}）· axis=${c.axis ?? "?"} · src=${c.sourceId} · tags=${(c.tags ?? []).join(",") || "—"}`,
      ),
    ].join("\n");
  },
});
