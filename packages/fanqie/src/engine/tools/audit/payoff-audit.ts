import { fingerprint } from "../../domain/lifecycle.js";

import { readCandidate } from "../../storage/candidates.js";
import { readChapter } from "../../storage/chapters.js";
import { isMissingFileError } from "../../storage/primitives.js";
import { readWorkMeta } from "../../storage/work-meta.js";
import { storePayoffAudit } from "../../storage/work-records.js";

import { loadEndingLexicon } from "../../quality-lexicon.js";
import { PayoffAuditorPort } from "../../ports/index.js";

import { asString, boolArg, fail, openWork } from "../context.js";

import { B, S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";

export const payoffAudit = defineTool({
  name: "fanqie_payoff_audit",
  description:
    "【旁路·诊断】兑付审计：对照章纲 ending 等与正文。Accept 已内嵌软传感；本工具仅诊断旁路。出问题或 require_payoff 时再用。不改写正文。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapter: S("章节 id（读 outline；未传 candidate/text 时也读正文）"),
    candidate: S("可选：审计该候选正文（仍用章节 outline）"),
    text: S("可选：直接审计这段文本（仍需 chapter 以取 outline）"),
    persist: B("是否写入 payoff-audits.json + ledger（默认 true）"),
  },
  required: ["chapter"],
  async execute(args, exec) {
    const chapterId = asString(args, "chapter", { required: true });
    const { dir } = await openWork(exec, args);
    const meta = await readWorkMeta(dir);
    let chapter: Awaited<ReturnType<typeof readChapter>>;
    try {
      chapter = await readChapter(dir, chapterId);
    } catch (err) {
      // 只有文件缺失才是「章节不存在」；front matter 损坏必须原样上报，否则作者会去新建一章盖掉坏稿。
      if (!isMissingFileError(err)) throw err;
      fail(`章节不存在：${chapterId}`, "not_found");
    }
    const candidateId = asString(args, "candidate");
    let body = asString(args, "text", { trim: false });
    let source = "chapter";
    let sourceId: string | undefined = chapterId;
    let label = `${chapter.title}（${chapterId}）`;
    if (candidateId) {
      const cand = await readCandidate(dir, candidateId);
      if (cand.chapterId !== chapterId) {
        fail(`候选 ${candidateId} 目标章为 ${cand.chapterId}，与 chapter=${chapterId} 不一致`);
      }
      body = cand.body;
      source = "candidate";
      sourceId = candidateId;
      label = `候选 ${candidateId} → ${chapterId}`;
    } else if (body !== undefined) {
      source = "text";
      sourceId = undefined;
      label = `文本 → ${chapterId}`;
    } else {
      body = chapter.body;
    }
    if (!body?.trim()) fail("正文为空，无法兑付审计");
    const result = PayoffAuditorPort.audit(chapter.outline, body, {
      premise: meta.premise,
      title: chapter.title,
      // per-work 词表：<作品目录>/quality-lexicon.json 的 endingKeywords
      // 覆盖默认题材词（换题材的书可自带锚点词，审计不再静默）。
      lexicon: await loadEndingLexicon(dir),
    });
    const persist = boolArg(args, "persist") ?? true;
    if (persist) {
      const codes = result.findings.filter((f) => f.severity !== "info").map((f) => f.code);
      await storePayoffAudit(dir, {
        chapterId,
        source,
        sourceId,
        bodyHash: fingerprint(body),
        outlineHash: fingerprint(chapter.outline),
        ok: result.ok,
        warningCount: result.warningCount,
        codes,
        summary: result.ok
          ? `兑付 ok · ${label}`
          : `兑付 warnings=${result.warningCount} · ${codes.join(",") || "?"} · ${label}`,
      });
    }
    return PayoffAuditorPort.format(label, result);
  },
});
