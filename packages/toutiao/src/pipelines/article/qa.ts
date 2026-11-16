import { AppError } from "@zhizhang/core/errors";
import type { StageRunner, StageSpec } from "@zhizhang/core/pipeline";
import type { ArticleStatus } from "../../domain/status.js";
import type { QaCheckResult } from "../../rules/bridge.js";
import { makePacket, refBlock } from "./helpers.js";
import type { ArticlePipelineResult, QaGate } from "./types.js";

export function resolveQaOutcome(
  qa: QaCheckResult,
  passScore: number,
): { status: ArticleStatus; qaGate: QaGate } {
  const passed = qa.overall >= passScore && qa.passed;
  if (passed) return { status: "待验收", qaGate: "pass" };
  return {
    status: "初稿待改",
    qaGate: {
      score: qa.overall,
      passScore,
      fails: qa.fails,
      hardGates: qa.hard_gates,
    },
  };
}

interface QaRevisionLoopOptions {
  runner: StageRunner;
  draft: string;
  qa: QaCheckResult;
  passScore: number;
  s6Text: string;
  runQa(stepId: string, text: string): Promise<QaCheckResult>;
  verifyRevision(text: string, stepId: string): Promise<void>;
}

export async function runQaRevisionLoop({
  runner,
  draft,
  qa,
  passScore,
  s6Text,
  runQa,
  verifyRevision,
}: QaRevisionLoopOptions): Promise<{ draft: string; qa: QaCheckResult }> {
  let currentDraft = draft;
  let qaResult = qa;
  for (let round = 1; round <= 2; round++) {
    if (qaResult.overall >= passScore && qaResult.passed) break;
    const qaReviseStage: StageSpec<{ draft: string; qa: QaCheckResult; round: number }, string> = {
      id: `qa-revise-${round}`,
      title: `质检回改第 ${round} 轮`,
      role: "editor",
      method: { stage: "toutiao.article.qa" },
      input: () => ({ draft: currentDraft, qa: qaResult, round }),
      shape:
        "仅针对 fails 与 hard_gates 指出的位置修改，不靠堆砌口语词或拆小标题凑分，输出完整 Markdown 正文。",
      format: "text",
      parse: (raw) => {
        const text = raw.trim();
        if (!text) {
          throw new AppError("model.output_invalid", `qa-revise 第 ${round} 轮输出为空`);
        }
        return text;
      },
    };
    currentDraft = await runner.stage(
      qaReviseStage,
      makePacket(s6Text ? [refBlock("s6-qa", "s6-qa.md", s6Text)] : []),
    );
    await verifyRevision(currentDraft, `qa-revise-${round}`);
    qaResult = await runQa(`qa-recheck-${round}`, currentDraft);
  }
  return { draft: currentDraft, qa: qaResult };
}

export function summarizeArticleDelivery(res: ArticlePipelineResult): string {
  if (res.status === "待验收") {
    return `已生成待验收草稿「${res.title}」（QA ${res.qa.overall} 分）`;
  }
  const gate = res.qaGate === "pass" ? undefined : res.qaGate;
  const failures = [...(gate?.hardGates ?? []), ...(gate?.fails.map((item) => item.message) ?? [])];
  return `草稿「${res.title}」已保存，QA ${res.qa.overall} 分，未达到 ${gate?.passScore ?? res.qa.overall} 分或仍有硬闸；文章保持初稿待改。未过项：${failures.join("；") || "无"}`;
}
