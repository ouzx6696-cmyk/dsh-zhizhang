import { writeLedgerEntry } from "../../storage/ledger.js";
import { readCandidate } from "../../storage/candidates.js";
import { readChapter } from "../../storage/chapters.js";

import { LintGate, StyleLinterPort, Scheduler } from "../../ports/index.js";

import { asString, fail, openWork } from "../context.js";
import { formatLint } from "../render.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const styleLint = defineTool({
  name: "fanqie_style_lint",
  description:
    "【按需诊断】语感雷达：传 candidate 时扫描正文并记录版本凭据；candidate_accept 已内置扫描，无需例行先调本工具。已有过期凭据须重扫。扫 chapter/text 仅诊断，扫描不证明内容质量。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    candidate: S("可选：候选 id；扫描其正文并签发 lintPassToken（仅证明已扫过）"),
    chapter: S("可选：章节 id，读盘扫描（诊断；不过 accept 闸）"),
    text: S("可选：直接扫描这段文本（诊断；不过 accept 闸，除非同时传 candidate）"),
  },
  required: [],
  async execute(args, exec) {
    const candidateId = asString(args, "candidate");
    if (candidateId) {
      const { dir } = await openWork(exec, args);
      const cand = await readCandidate(dir, candidateId);
      const scan = await StyleLinterPort.scan(cand.body),
        hits = scan.hits;
      const pass = await LintGate.issueToken(dir, candidateId, hits.length, cand.body);
      return [
        formatLint(`候选 ${candidateId} → ${cand.chapterId}`, scan),
        "",
        `lintPassToken：${pass.token}`,
        `lintHitCount：${pass.hitCount}（命中数；token 只证明已扫过，扫过≠过关）`,
        `（已写入候选；accept 可不传 token，或显式传此值）`,
        `下一步：${Scheduler.nextHint("style_lint")}`,
      ].join("\n");
    }
    let text = asString(args, "text", { trim: false });
    let label = "传入文本";
    if (text === undefined) {
      const chapterId = asString(args, "chapter");
      if (!chapterId) fail("请提供 candidate、text 或 chapter");
      const { dir } = await openWork(exec, args);
      const ch = await readChapter(dir, chapterId);
      text = ch.body;
      label = `${ch.title}（${ch.id}）`;
      const scan = await StyleLinterPort.scan(text),
        hits = scan.hits;
      await writeLedgerEntry(dir, {
        chapterId,
        kind: "style_lint",
        summary: `语感雷达章节 ${chapterId}：${hits.length} 处命中（诊断，不签发 accept token）`,
        styleHitCount: hits.length,
      });
      return [
        formatLint(label, scan),
        "",
        "说明：章节扫描是诊断，不绑定候选；候选采纳会扫描当前字节。",
      ].join("\n");
    }
    const scan = await StyleLinterPort.scan(text);
    return [formatLint(label, scan), "", "说明：纯 text 扫描是诊断；候选采纳会扫描当前字节。"].join(
      "\n",
    );
  },
});
