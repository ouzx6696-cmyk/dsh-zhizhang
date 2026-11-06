import { resolveWorkDir } from "../../work-store.js";
import { ensureStorage } from "../../storage/paths.js";
import { NovelError } from "../../errors.js";

import { readWorkMeta } from "../../storage/work-meta.js";
import { inspectPendingAccept, resumePendingAccept } from "../../storage/accept-journal.js";
import {
  hasPendingChapterSave,
  inspectPendingChapterSave,
  resumePendingChapterSave,
} from "../../storage/chapter-journal.js";
import { assertNoInspirationMarker } from "../../storage/inspiration-journal.js";
import { Scheduler } from "../../ports/index.js";

import { asString, config, fail, openWork } from "../context.js";
import { renderStatus } from "../render.js";
import { E, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const status = defineTool({
  name: "fanqie_status",
  description:
    "查看当前作品状态：根基摘要、章节进度与字数、下一步建议。上下文压缩后先调它恢复现场。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    recovery: E(
      ["inspect", "resume"],
      "采纳中断时：inspect 检查；resume 在校验无冲突后完成原操作（须指定 work）",
    ),
  },
  required: [],
  async execute(args, exec) {
    const recovery = asString(args, "recovery");
    if (recovery) {
      if (recovery !== "inspect" && recovery !== "resume")
        fail("recovery 只支持 inspect 或 resume");
      const work = asString(args, "work", { required: true });
      const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
      const dir = await resolveWorkDir(paths, work);
      await assertNoInspirationMarker(dir);
      if (await hasPendingChapterSave(dir)) {
        if (recovery === "inspect") {
          const r = await inspectPendingChapterSave(dir);
          const label =
            r.kind === "brief"
              ? "简报留痕"
              : r.kind === "payoff"
                ? "兑付留痕"
                : r.kind === "lint"
                  ? "扫描留痕"
                  : r.kind === "stage"
                    ? "候选暂存"
                    : "章节保存";
          return [
            `${label}恢复记录：${r.id}`,
            `- 章节 ${r.chapterId || "未指定"}${r.candidateId ? ` · 候选 ${r.candidateId}` : ""} · ${r.createdAt}`,
            ...r.writes.map((w) => `- ${w.file}：${w.state}`),
            r.conflict
              ? "发现冲突，请保留文件并人工核对。"
              : "无文件冲突，可在原操作结束或原进程停止后用 recovery=resume 恢复。",
          ].join("\n");
        }
        const r = await resumePendingChapterSave(dir);
        if (r.kind === "stage")
          return `已恢复候选 ${r.candidateId} 的暂存；候选正文与元数据已对齐。`;
        if (r.kind === "lint")
          return `已恢复候选 ${r.candidateId} 的扫描留痕；凭据与审校账本已对齐。若候选正文已变，请重新扫描。`;
        return r.kind === "brief" || r.kind === "payoff"
          ? `已恢复${r.kind === "brief" ? "简报" : "兑付"}留痕；记录与审校账本已对齐。`
          : `已恢复章节 ${r.chapterId} 的保存；正文和作品目录已对齐。`;
      }
      if (recovery === "inspect") {
        const r = await inspectPendingAccept(dir);
        return [
          `采纳恢复记录：${r.id}`,
          `- 章节 ${r.chapterId} · 候选 ${r.candidateId} · 模式 ${r.mode} · ${r.createdAt}`,
          ...r.writes.map((w) => `- ${w.file}：${w.state}`),
          ...r.guards.map((g) => `- ${g.file}：${g.state}`),
          r.conflict
            ? "发现冲突；不会自动覆盖，请保留文件并人工核对。"
            : "无文件冲突；同一进程操作结束后或原进程停止后，可传 recovery=resume 完成原操作。",
        ].join("\n");
      }
      const r = await resumePendingAccept(dir);
      return `已恢复原采纳：候选 ${r.candidateId} → 章节 ${r.chapterId}（${r.mode}）。正文、作品目录、候选标记及留痕已对齐；已有的手写状态未被覆盖，请按需核对。不要重复采纳。`;
    }
    let opened;
    try {
      opened = await openWork(exec, args);
    } catch (err) {
      // 起步有两条路（先拆书 / 先建作品）——status 是仪表盘，不该在空库时裸报错。
      if (err instanceof NovelError && err.code === "no_work") {
        return [
          "## 尚无作品（起步两条路）",
          "- 有参考书（推荐）：fanqie_library_import → library_plan → 拆书 9 步 → combo_suggest → inspire_accept(apply=true) 长出根基/章纲",
          "- 直接开写：fanqie_project_create → foundation_set → outline_set → chapter_brief(lean)",
          "",
          `下一步（默认）：${Scheduler.nextHint("work_status")}`,
        ].join("\n");
      }
      throw err;
    }
    return renderStatus(await readWorkMeta(opened.dir), opened.dir, opened.paths);
  },
});
