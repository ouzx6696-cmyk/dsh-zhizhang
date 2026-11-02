import { LibraryPort } from "../../ports/index.js";

import { asString } from "../context.js";
import { S, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryCardAccept = defineTool({
  name: "fanqie_library_card_accept",
  description:
    "【闭环·库 7/9 采纳】显式采纳卡入库（v2 校验 5 项 + 证据回溯）。未 accept 不得当已入库。下一步 8/9：library_report → 9/9 combo（audit 为诊断旁路）。",
  properties: {
    candidate: S("候选 id（lcand-…）"),
    working_dir: WORKING_DIR,
  },
  required: ["candidate"],
  async execute(args, exec) {
    const candId = asString(args, "candidate", { required: true });
    const paths = await openLibrary(exec, args, true);
    const { cardId, title, warnings, judgment } = await LibraryPort.acceptCard(paths, candId);
    return [
      `已采纳技法卡「${title}」→ cardId=${cardId}`,
      `- 状态：accepted`,
      `- 可检索：fanqie_library_search / library_card_get`,
      ...(warnings && warnings.length
        ? ["", "【入库审计提示】", ...warnings.map((w) => `- ${w}`)]
        : []),
      ...(judgment && judgment.length
        ? ["", "【判断面（脚本核不了）】", ...judgment.map((j) => `- ${j}`)]
        : []),
      "",
      "下一步 8/9：fanqie_library_report → 9/9 fanqie_library_combo_suggest（library_audit 为诊断旁路：机械面通过≠卡能用，勿例行）",
    ].join("\n");
  },
});
