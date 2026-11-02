import { readCandidate } from "../../storage/candidates.js";
import { readChapter } from "../../storage/chapters.js";

import { resolvePrevChapter } from "../../services/chapter-context.js";

import { NovelSenseAuditorPort } from "../../ports/index.js";

import { asString, fail, openWork } from "../context.js";

import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const novelSenseAudit = defineTool({
  name: "fanqie_novel_sense_audit",
  description:
    "【旁路·诊断】书感软雷达。Accept 已内嵌；本工具仅诊断旁路。只诊断，不签发 token；strict_novel 为旁路硬拒。不作质量法。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    candidate: S("可选：候选 id，扫其正文"),
    chapter: S("可选：章节 id，读盘扫描"),
    text: S("可选：直接扫描这段文本"),
    prev_chapter: S("可选：前章 id，用于同构检测；省略时若扫 chapter/candidate 则自动取上一章"),
    prev_text: S("可选：前章正文（与 prev_chapter 二选一）"),
  },
  required: [],
  async execute(args, exec) {
    const candidateId = asString(args, "candidate");
    let text = asString(args, "text", { trim: false });
    let label = "传入文本";
    let dir = null;
    let chapterId = null;
    if (candidateId) {
      const opened = await openWork(exec, args);
      dir = opened.dir;
      const cand = await readCandidate(dir, candidateId);
      text = cand.body;
      chapterId = cand.chapterId;
      label = `候选 ${candidateId} → ${cand.chapterId}`;
    } else if (text === undefined) {
      const chId = asString(args, "chapter");
      if (!chId) fail("请提供 candidate、text 或 chapter");
      const opened = await openWork(exec, args);
      dir = opened.dir;
      const ch = await readChapter(dir, chId);
      text = ch.body;
      chapterId = ch.id;
      label = `${ch.title}（${ch.id}）`;
    }
    if (!text?.trim()) fail("正文为空，无法书感审计");
    let prevBody = asString(args, "prev_text", { trim: false }) ?? null;
    const prevChapterId = asString(args, "prev_chapter");
    if (!prevBody && prevChapterId) {
      if (!dir) {
        const opened = await openWork(exec, args);
        dir = opened.dir;
      }
      const prev = await readChapter(dir, prevChapterId);
      prevBody = prev.body || null;
      label = `${label} · 对照前章 ${prevChapterId}`;
    } else if (!prevBody && dir && chapterId) {
      const prev = await resolvePrevChapter(dir, chapterId);
      if (prev) {
        prevBody = prev.body || null;
        label = `${label} · 对照前章 ${prev.meta.id}`;
      }
    }
    const result = NovelSenseAuditorPort.audit(text, { prevBody });
    return NovelSenseAuditorPort.format(label, result);
  },
});
