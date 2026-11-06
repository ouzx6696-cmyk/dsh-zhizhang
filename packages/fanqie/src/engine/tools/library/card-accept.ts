import { FoundationPort, LibraryPort, styleCardFoundationEntry } from "../../ports/index.js";

import { asString, openWork } from "../context.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

import { openLibrary } from "./context.js";
export const libraryCardAccept = defineTool({
  name: "fanqie_library_card_accept",
  description:
    "【闭环·库 7/9 采纳】显式采纳卡入库（v2 校验 5 项 + 证据回溯）。未 accept 不得当已入库。文风卡（dimension=prose）采纳时把文风三段+迁移试写追加进目标作品 foundation.style（追加语义，带日期与卡号；work 缺省按会话最近作品或唯一作品解析）。下一步 8/9：library_report → 9/9 combo（audit 为诊断旁路）。",
  properties: {
    candidate: S("候选 id（lcand-…）"),
    work: WORK_OPT,
    working_dir: WORKING_DIR,
  },
  required: ["candidate"],
  async execute(args, exec) {
    const candId = asString(args, "candidate", { required: true });
    const paths = await openLibrary(exec, args, true);
    // 文风卡落根基是采纳语义的一部分：先解析候选并解析到目标作品，解析不到就报错，
    // 不让作者以为采纳完成而文风没有落盘。
    const candidate = await LibraryPort.getCandidate(paths, candId);
    const work = candidate.dimension === "prose" ? await openWork(exec, args) : undefined;
    const { cardId, title, warnings, judgment } = await LibraryPort.acceptCard(paths, candId);
    const lines = [
      `已采纳技法卡「${title}」→ cardId=${cardId}`,
      `- 状态：accepted`,
      `- 可检索：fanqie_library_search / library_card_get`,
    ];
    if (work) {
      const card = await LibraryPort.getCard(paths, cardId);
      const meta = await FoundationPort.appendStyleCard(work.dir, styleCardFoundationEntry(card));
      lines.push(
        `- 文风三段+迁移试写已追加进作品「${meta.title}」foundation.style（条目头：文风卡 ${cardId} · 当日日期）`,
      );
    }
    lines.push(
      ...(warnings && warnings.length
        ? ["", "【入库审计提示】", ...warnings.map((w) => `- ${w}`)]
        : []),
      ...(judgment && judgment.length
        ? ["", "【判断面（脚本核不了）】", ...judgment.map((j) => `- ${j}`)]
        : []),
      "",
      "下一步 8/9：fanqie_library_report → 9/9 fanqie_library_combo_suggest（library_audit 为诊断旁路：机械面通过≠卡能用，勿例行）",
    );
    return lines.join("\n");
  },
});
