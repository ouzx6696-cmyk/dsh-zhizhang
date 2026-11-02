import {
  LibraryPort,
  coerceAxis,
  formatHumanFeelBlock,
  formatBookCraftBlock,
  formatMindBlock,
  formatHandoffBlock,
  formatModuleBlockV2,
} from "../../ports/index.js";

import { asString } from "../context.js";
import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryCardGet = defineTool({
  name: "fanqie_library_card_get",
  description:
    "【闭环·库·辅助】读已采纳卡全文（axis + craft/mind 证据）。确认后可 combo 或直接注入 brief。",
  properties: {
    card: S("cardId"),
    working_dir: WORKING_DIR,
  },
  required: ["card"],
  async execute(args, exec) {
    const cardId = asString(args, "card", { required: true });
    const paths = await openLibrary(exec, args, false);
    const card = await LibraryPort.getCard(paths, cardId);
    const axis = coerceAxis(card);
    const mech = card.mechanisms
      .map(
        (m: import("../../ports/library/types.js").MechanismInput, i: number) =>
          `${i + 1}. ${m.name}\n   体验：${m.experience}\n   重建：${m.rebuild}\n   可弃：${m.discard}\n   失败：${m.failWhen}`,
      )
      .join("\n");
    const lines = [
      `# ${card.title}（${card.id}）`,
      `- axis：${axis}`,
      `- sourceId：${card.sourceId}`,
      `- status：${card.status}`,
      `- kind（次标签）：${card.kind ?? "（未标）"}`,
      `- tags：${card.tags.join("、") || "（无）"}`,
      `- readingRange：${card.readingRange}`,
      "",
    ];
    if (card.schemaVersion === 2 || card.layer) {
      lines.push("## 模块（v2）", formatModuleBlockV2(card), "");
    }
    const isV2 = card.schemaVersion === 2 || Boolean(card.layer);
    if (!isV2 && axis === "mind") {
      lines.push("## 创作思维（mind）", formatMindBlock(card.mind), "");
    } else if (!isV2) {
      lines.push(
        "## 活人证据（humanFeel · 写法+状态）",
        formatHumanFeelBlock(card.humanFeel),
        "",
        "## 续写面（bookCraft）",
        formatBookCraftBlock(card.bookCraft),
        "",
      );
    }
    lines.push("## handoff", formatHandoffBlock(card.handoff), "");
    lines.push("## 机制", mech || "（无）", "", "## 正文", card.body);
    return lines.join("\n");
  },
});
