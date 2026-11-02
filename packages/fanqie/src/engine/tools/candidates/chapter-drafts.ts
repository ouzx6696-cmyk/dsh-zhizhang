import { listCandidates } from "../../storage/candidates.js";
import { MultiDraftPort, Scheduler } from "../../ports/index.js";

import { asString, boolArg, openWork } from "../context.js";
import { B, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const chapterDrafts = defineTool({
  name: "fanqie_chapter_drafts",
  description:
    "【旁路·多草稿】列出某章待采纳候选（含 draftLabel）；可选带近期已采纳。不要求 multiDraft 开启。下一步：选稿 candidate_accept（内置扫描），或开启后 unify_brief。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id"),
    include_accepted: B("是否列出本章近期已采纳候选（默认 false）"),
  },
  required: ["chapter"],
  async execute(args, exec) {
    const chapterId = asString(args, "chapter", { required: true });
    const includeAccepted = boolArg(args, "include_accepted") === true;
    const { dir, key } = await openWork(exec, args);
    const all = await listCandidates(dir);
    const forCh = all.filter((c) => c.chapterId === chapterId);
    const pending = forCh.filter((c) => c.pending);
    // listCandidates 已按 stagedAt 倒序；近期已采纳取头部，不是尾部。
    const accepted = includeAccepted ? forCh.filter((c) => !c.pending).slice(0, 5) : [];
    const lines = [
      `章 ${chapterId} · 作品 ${key}`,
      `待采纳 ${pending.length} 条` +
        (MultiDraftPort.isEnabled()
          ? " · 多草稿统一整理：已开启"
          : " · 多草稿统一整理：关闭（默认）"),
    ];
    if (pending.length === 0) {
      lines.push("（无待采纳）");
    } else {
      for (const c of pending) {
        lines.push(
          `- ${c.id}` +
            (c.draftLabel ? `「${c.draftLabel}」` : "") +
            ` · ${c.wordCount} 字` +
            (c.lintPassToken && c.lintedAt ? " · lint✓" : " · 缺 lint") +
            (c.source ? ` · ${c.source}` : "") +
            (c.editOf ? ` · editOf=${c.editOf}` : "") +
            (c.unifyOf?.length ? ` · unifyOf=${c.unifyOf.join(",")}` : "") +
            (c.note ? ` · ${c.note}` : ""),
        );
      }
    }
    if (accepted.length) {
      lines.push("近期已采纳：");
      for (const c of accepted) {
        lines.push(`- ${c.id} · ${c.wordCount} 字 · accepted`);
      }
    }
    if (pending.length >= 2 && MultiDraftPort.isEnabled()) {
      lines.push(
        `旁路下一步：fanqie_candidate_unify_brief(chapter=${chapterId}) → 整理 → unify_stage`,
      );
    } else if (pending.length >= 2 && !MultiDraftPort.isEnabled()) {
      lines.push(`同章多稿可用；统一整理需开启：${MultiDraftPort.enableHint()}`);
    } else if (pending.length === 1) {
      lines.push(`下一步：${Scheduler.nextHint("candidate_stage")}`);
    }
    return lines.join("\n");
  },
});
