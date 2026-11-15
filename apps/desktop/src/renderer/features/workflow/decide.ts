/** 等你决定：采纳 / 放弃候选稿。流水线面板与中栏对照视图共用这一条路径。 */
import type { RunSummary, Target } from "../../../shared/views";
import { desktop } from "../../state/desktop";
import type { CompareSides } from "./DraftCompare";
import { hasCandidate } from "./workflow-model";

export async function decideRun(
  target: Target,
  run: Pick<RunSummary, "id" | "kind">,
  chapter: string,
  decision: "apply" | "discard",
  sides: CompareSides | null,
): Promise<RunSummary> {
  // 章节候选稿：先经写作区命令落盘（采纳写正文 / 放弃记拒收），再结束这次运行。
  if (hasCandidate(run.kind) && chapter && sides) {
    if (decision === "apply")
      await desktop.workbench("fanqie.candidate.accept", {
        work: target.path,
        chapter,
        candidateId: run.id,
        base: sides.official.revision,
      });
    else
      await desktop.workbench("fanqie.candidate.reject", {
        work: target.path,
        chapter,
        candidateId: run.id,
      });
  }
  return desktop.decideRun({ runId: run.id, target }, decision);
}
