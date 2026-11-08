import { sha256 } from "../../../../packages/core/src/fsx";
import { pairVote, review, revised, type Draft, type Review } from "./schema";
import { runTaskPool } from "../session/task-pool";
import type { ContextBlock } from "../../../../packages/core/src/workflow";
import type { WorkflowRun } from "./run";

const READERS = {
  fanqie: {
    standard: ["追更读者", "重视人物的读者", "挑剔老读者"],
    premium: ["追更读者", "挑剔老读者", "重视人物的读者", "重视节奏的读者", "重视事实与接续的读者"],
  },
  toutiao: {
    standard: ["四五十岁的资讯读者", "关心身边事的普通读者", "挑剔的老读者"],
    premium: [
      "四五十岁的资讯读者",
      "关心身边事的普通读者",
      "挑剔的老读者",
      "城市上班族",
      "重视事实可信度的读者",
    ],
  },
} as const;
/** Parallel reader calls per challenger; each vote is an independent fresh request. */
const VOTE_CONCURRENCY = 4;
/**
 * King-of-the-hill reader comparison. Each challenger meets the current winner once per persona in
 * both positions; votes run in parallel and only a position-stable verdict counts.
 */
export async function selectDraft(
  run: WorkflowRun,
  drafts: Draft[],
  card: string,
  mode: "fanqie" | "toutiao" = "fanqie",
  material?: ContextBlock[],
) {
  let winner = 0;
  const comparisons: { left: number; right: number; winner: number | null; reasons: string[] }[] =
    [];
  const readers =
    READERS[mode][run.journal.record.request.grade === "premium" ? "premium" : "standard"];
  for (let challenger = 1; challenger < drafts.length; challenger++) {
    const incumbent = winner;
    const jobs = readers.flatMap((persona, index) =>
      [false, true].map((swapped) => ({ persona, index, swapped })),
    );
    const outcomes = await runTaskPool(jobs.length, VOTE_CONCURRENCY, async (job) => {
      const { persona, index, swapped } = jobs[job];
      const a = swapped ? challenger : incumbent,
        b = swapped ? incumbent : challenger;
      const vote = await run.model(
        `pair-${challenger}-${index}-${Number(swapped)}`,
        "读者比较",
        "editor",
        card,
        { persona, A: drafts[a], B: drafts[b] },
        '你是给定画像的普通读者，只依据正文比较继续阅读意愿，不评估软件。指出每稿具体弃读段；位置交换后重新独立判断。返回 {"winner":"A或B或tie","reason":"正文证据","abandonA":"段落及原因或未发现","abandonB":"段落及原因或未发现"}。',
        pairVote,
        material ? { material } : {},
      );
      return {
        persona,
        winner: vote.winner === "tie" ? -1 : vote.winner === "A" ? a : b,
        reason: `${persona}：${vote.reason}；A：${vote.abandonA}；B：${vote.abandonB}`,
      };
    });
    const failed = outcomes.find((outcome) => outcome.status === "failed");
    if (failed?.status === "failed") throw failed.error;
    let left = 0,
      right = 0;
    const reasons: string[] = [];
    for (const [index] of readers.entries()) {
      const pair = [outcomes[index * 2], outcomes[index * 2 + 1]].map((outcome) =>
        outcome.status === "ok" ? outcome.value : undefined,
      );
      for (const vote of pair) if (vote) reasons.push(vote.reason);
      if (pair[0] && pair[1] && pair[0].winner === pair[1].winner && pair[0].winner >= 0) {
        if (pair[0].winner === incumbent) left++;
        else right++;
      }
    }
    comparisons.push({
      left: incumbent,
      right: challenger,
      winner: left === right ? null : right > left ? challenger : incumbent,
      reasons,
    });
    if (right > left) winner = challenger;
  }
  const settings = run.host.settings();
  const independent =
    settings.writer.provider !== settings.editor.provider ||
    settings.writer.model !== settings.editor.model;
  return {
    winner,
    comparisons,
    independent,
    note: independent
      ? "独立配置模型的读者比较，仅供作者选稿"
      : "写手与评审使用同一模型，排序仅供参考；作者可改选",
  };
}
function revisionScope(before: string, after: string, report: Review) {
  const paragraphs = before.split(/\n\s*\n/);
  const allowed = new Set<number>();
  for (const issue of report.hard) {
    const start = before.indexOf(issue.quote);
    let offset = 0;
    for (const [index, paragraph] of paragraphs.entries()) {
      const at = before.indexOf(paragraph, offset);
      if (at <= start && start < at + paragraph.length)
        for (const near of [index - 1, index, index + 1]) allowed.add(near);
      offset = at + paragraph.length;
    }
  }
  let cursor = 0,
    retained = 0;
  for (const [index, paragraph] of paragraphs.entries()) {
    if (allowed.has(index)) continue;
    const at = after.indexOf(paragraph, cursor);
    if (at < 0) throw new Error("修订改动了硬伤范围以外的段落，未交付");
    cursor = at + paragraph.length;
    retained += paragraph.length;
  }
  if (Math.abs(after.length - before.length) > Math.max(200, before.length * 0.3))
    throw new Error("修订篇幅变化超过 30%，需要作者明确扩大范围");
  return retained;
}
export async function editDraft(
  run: WorkflowRun,
  initial: Draft,
  editCard: string,
  reviseCard: string,
) {
  let current = initial;
  let report: Review = { bodyHash: "", hard: [], suggestions: [] };
  for (let round = 0; round <= 2; round++) {
    const hash = sha256(current.body);
    report = await run.model(
      `review-${round}`,
      "硬伤审读",
      "editor",
      editCard,
      { draft: current },
      '审读最多5条真正影响读者理解、信任或设定一致性的硬伤。章纲偏离本身只列建议。每条必须引用正文、写明读者影响和定向改法。返回 {"hard":[{"location":"位置","quote":"正文原文","impact":"读者会怎样","fix":"局部改法"}],"suggestions":["章纲偏离或风格建议"]}。',
      (v) => review(v, current.body, hash),
    );
    if (!report.hard.length)
      return { draft: current, review: report, rounds: round, unresolved: false };
    // The author is the final judge: after two targeted rounds the best draft is delivered with its
    // open issues listed, instead of discarding the whole run.
    if (round === 2) return { draft: current, review: report, rounds: round, unresolved: true };
    const previous = current;
    current = await run.model(
      `revise-${round}`,
      "定向修订",
      "writer",
      reviseCard,
      { draft: previous, report },
      '只修改硬伤原文所在段落及相邻段，保护其他段落，篇幅变化不超过30%。返回 {"title":"标题","body":"完整修订正文","resolved":["按硬伤顺序说明处理"]}。',
      (v) => {
        const result = revised(v);
        if (result.resolved.length !== report.hard.length)
          throw new Error("修订未逐项交代硬伤处理");
        revisionScope(previous.body, result.body, report);
        return result;
      },
    );
  }
  throw new Error("审读未结束");
}
