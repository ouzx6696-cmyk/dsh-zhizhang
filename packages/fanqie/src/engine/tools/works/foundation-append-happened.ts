import { FoundationPort } from "../../ports/index.js";

import { asString, boolArg, fail, openWork } from "../context.js";

import { B, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const foundationAppendHappened = defineTool({
  name: "fanqie_foundation_append_happened",
  description:
    "向根基 happened 追加一句本章后果（短行；按 chapter 去重）；修订后可显式 replace=true 更新该章记录。accept 不覆盖作者已有记录。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id（用于去重标记）"),
    text: S("一句后果（建议≤200字；通常来自 ending 或作者摘要）"),
    title: S("可选章节标题"),
    replace: B("显式替换该章已有的唯一记录；不改其他章节或作者手写内容"),
  },
  required: ["chapter", "text"],
  async execute(args, exec) {
    const chapterId = asString(args, "chapter", { required: true });
    const textLine = asString(args, "text", { required: true });
    const { dir } = await openWork(exec, args);
    const result = await FoundationPort.appendHappened(dir, {
      chapterId,
      text: textLine,
      title: asString(args, "title"),
      replace: boolArg(args, "replace") === true,
    });
    if (result.replaced) {
      return `已更新 happened：${result.line}`;
    }
    if (result.appended) {
      return `已追加 happened：${result.line}`;
    }
    if (result.reason === "already_recorded") {
      return `未追加（${chapterId} 已在 happened 中）。现有条目与本次相同标记；如需更新请显式传 replace=true。`;
    }
    if (result.reason === "ambiguous_record") {
      fail(
        `章节 ${chapterId} 的记录不唯一或嵌在手写段落中，请核对 happened 后用 foundation_set 手动修改。`,
        "ambiguous_record",
      );
    }
    if (result.reason === "empty_text") {
      fail("text 不能为空");
    }
    return `未追加（${result.reason ?? "unknown"}）`;
  },
});
