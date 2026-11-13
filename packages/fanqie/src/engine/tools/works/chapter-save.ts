import { asEnum } from "../../parse.js";
import { countWords } from "../../storage/primitives.js";

import { readChapter, updateChapter } from "../../storage/chapters.js";

import {
  firstDenyCode,
  firstDenyText,
  SAVE_BYPASS_WORD_THRESHOLD,
  SaveBypassGate,
} from "../../ports/index.js";
import { CHAPTER_STATUSES } from "../../types.js";
import { asString, boolArg, config, fail, openWork } from "../context.js";

import { B, E, I, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";
import { finalizeProblem } from "../../../review.js";
export const chapterSave = defineTool({
  name: "fanqie_chapter_save",
  description:
    "作者显式落盘或定稿改 status。创作默认请走 candidate 链。大正文（超过旁路字数阈值）须 confirm_bypass=true，否则拒绝。可省略 content 仅改 status/title/position（须章已存在）。定稿正文修改须 force=true，保留历史并降回草稿。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id；不存在则新建（新建必须带 content）"),
    title: S("章节标题"),
    content: S("完整正文；省略则保留已有正文（仅改 status/title/position）"),
    status: E(CHAPTER_STATUSES, "可选状态"),
    position: I("可选排序位置（从 1）"),
    force: B("明确允许修订定稿正文；修改后需重新审读定稿"),
    review_summary: S("当前版本完整审读的依据、结论与问题；只是声明，不是自动质量证明"),
    review_result: E(["pass", "blocked"], "审读声明结果"),
    reviewed_by: S("审读声明者"),
    acknowledge_revision: B("声明已核对本章修订影响；须提供当前 expected_revision"),
    expected_read_version: S("可选读章所得 readVersion；状态或审读记录变化则拒绝"),
    expected_revision: S("可选现行章节 revision；不匹配则拒绝覆盖"),
    confirm_bypass: B(
      `大正文旁路确认：正文超过 ${SAVE_BYPASS_WORD_THRESHOLD} 字直写时必须为 true；短稿/仅改状态可不传`,
    ),
  },
  required: ["chapter"],
  async execute(args, exec) {
    const chapterId = asString(args, "chapter", { required: true });
    const contentArg = asString(args, "content", { trim: false });
    const confirmBypass = boolArg(args, "confirm_bypass") === true;
    const { dir } = await openWork(exec, args);
    const title = asString(args, "title");
    let bypassNoted = false;
    if (contentArg === undefined) {
      const metaGate = SaveBypassGate.evaluate({
        contentProvided: false,
        wordCount: 0,
        confirmBypass: false,
      });
      if (!metaGate.ok) fail(firstDenyText(metaGate), firstDenyCode(metaGate));
    } else {
      if (!contentArg.trim()) fail("content 不能为空；仅改状态请省略 content 参数");
      const wc = countWords(contentArg);
      const gate = SaveBypassGate.evaluate({
        contentProvided: true,
        wordCount: wc,
        confirmBypass,
      });
      if (!gate.ok) fail(firstDenyText(gate), firstDenyCode(gate));
      bypassNoted = gate.messages.some((m) => m.code === "save_bypass_confirmed");
    }
    const status = asEnum(args, "status", CHAPTER_STATUSES);
    if (
      args.position !== undefined &&
      (typeof args.position !== "number" || !Number.isInteger(args.position) || args.position < 1)
    )
      fail("position 必须是从 1 开始的整数");
    const position = typeof args.position === "number" ? args.position : undefined;
    if (status === "final" && config.requireEditorPass === true) {
      const body = contentArg ?? (await readChapter(dir, chapterId)).body;
      const denied = await finalizeProblem(dir, chapterId, body, true);
      if (denied) fail(denied, "writer_finalize_blocked");
    }
    const saved = await updateChapter(dir, {
      id: chapterId,
      title,
      body: contentArg,
      status,
      position,
      force: boolArg(args, "force") === true,
      expectedRevision: asString(args, "expected_revision"),
      expectedReadVersion: asString(args, "expected_read_version"),
      reviewSummary: asString(args, "review_summary"),
      reviewResult: asString(args, "review_result") as "pass" | "blocked" | undefined,
      reviewedBy: asString(args, "reviewed_by"),
      acknowledgeRevision: boolArg(args, "acknowledge_revision") === true,
      ledgerEntry: `chapter_save 显式保存 ${chapterId}${bypassNoted ? " confirm_bypass=true" : ""}`,
    });
    const bypassTag = bypassNoted
      ? " confirm_bypass=true"
      : contentArg === undefined
        ? " 仅元数据/status"
        : "";
    return `已保存「${saved.title}」（${saved.id}）：${saved.wordCount} 字，状态 ${saved.status}。已记 ledger kind=chapter_save_direct${bypassTag}。`;
  },
});
