import React from "react";
import { GitCompare, Hourglass } from "lucide-react";
import { COPY, DESKTOP_COPY as C, ERROR_COPY, formatCost } from "@zhizhang/ui/copy";
import { Button, Notice, StatusChip } from "@zhizhang/ui/primitives";
import type { RunDetail, RunSummary, WorkflowAction } from "../../../shared/views";
import { desktopStore, useDesktop } from "../../state/store";
import {
  hasCandidate,
  kindLabel,
  progressGroups,
  progressIndex,
  requestField,
  runActions,
  stateLabel,
  stateTone,
} from "./workflow-model";
import { ProgressTrack, StageSection } from "./RunStages";

/** 当前运行卡：进度、等你决定（候选稿对照 → 采纳/放弃）、阶段明细与用量。 */
export function RunCard({
  run,
  detail,
  onAction,
  onDecide,
  busy,
  compact,
}: {
  run: RunSummary;
  detail: RunDetail | null;
  onAction: (action: WorkflowAction) => void;
  onDecide: (decision: "apply" | "discard") => void;
  busy: boolean;
  compact: boolean;
}) {
  const chapter = requestField(detail, "chapterId");
  const chapters = useDesktop((s) => s.chapters);
  const compare = useDesktop((s) => s.compare);
  const awaiting = run.state === "awaiting-author";
  const tokens = run.usage.input + run.usage.cachedInput + run.usage.output;
  const chapterAt = chapters.findIndex((c) => c.id === chapter);
  const chapterTitle = chapterAt >= 0 ? chapters[chapterAt].title : undefined;
  const candidate = hasCandidate(run.kind) && Boolean(chapter);
  const comparing = compare?.runId === run.id;
  const actions = runActions(run.state);
  const groups = progressGroups(run.kind);
  const at = Math.min(progressIndex(run), groups.length - 1);
  return (
    <section
      className="zz-run"
      data-testid="workflow-run"
      data-state={run.state}
      data-kind={run.kind}
    >
      <header className="zz-run__head">
        <div className="zz-run__title">
          <strong>{kindLabel(run.kind)}</strong>
          {chapter ? (
            <span className="zz-run__target" data-testid="workflow-target">
              {chapterAt >= 0
                ? C.workflow.chapterRef(
                    chapterAt + 1,
                    chapterTitle && chapterTitle !== chapter ? chapterTitle : "",
                  )
                : chapter}
            </span>
          ) : null}
        </div>
        <StatusChip tone={stateTone(run.state)} label={stateLabel(run.state)} dot />
      </header>
      <ProgressTrack run={run} />
      {/* 读屏只宣告阶段级变化：当前分组与状态，不朗读用量数字。 */}
      <p className="zz-hidden-value" aria-live="polite">
        {groups.length && at >= 0
          ? C.workflow.groupLabel(stateLabel(run.state), groups[at])
          : stateLabel(run.state)}
      </p>
      {awaiting ? (
        <div className="zz-decide" data-testid="workflow-decide">
          <p className="zz-decide__title">
            <Hourglass size={14} aria-hidden="true" />
            {COPY["workflow.awaiting_author"]}
          </p>
          <p className="zz-decide__hint">
            {candidate
              ? comparing
                ? C.workflow.compareOpened
                : C.workflow.decideCandidate
              : C.workflow.decideGeneric}
          </p>
          <div className="zz-row">
            {candidate ? (
              <Button
                variant="strong"
                size="sm"
                data-testid="workflow-compare"
                disabled={comparing}
                onClick={() =>
                  desktopStore.set({
                    compare: { target: run.target, runId: run.id, chapter },
                    view: "writing",
                  })
                }
              >
                <GitCompare size={14} aria-hidden="true" />
                {C.workflow.openCompare}
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  data-testid="workflow-adopt"
                  disabled={busy}
                  onClick={() => onDecide("apply")}
                >
                  {C.workflow.adopt}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="workflow-discard"
                  disabled={busy}
                  onClick={() => onDecide("discard")}
                >
                  {C.workflow.discard}
                </Button>
              </>
            )}
          </div>
        </div>
      ) : null}
      {run.error ? (
        <Notice tone="bad" message={ERROR_COPY[run.error.code]} detail={run.error.message} />
      ) : null}
      <StageSection run={run} compact={compact} />
      <footer className="zz-run__foot">
        <span className="zz-run__usage" data-testid="workflow-usage">
          {C.workflow.usage(tokens, formatCost(run.usage.cost))}
        </span>
        {actions.length ? (
          <span className="zz-run__actions" role="group" aria-label={C.workflow.controls}>
            {actions.map((action) => (
              <Button
                key={action}
                size="sm"
                variant={action === "stop" ? "ghost" : "secondary"}
                data-testid={`workflow-${action}`}
                disabled={busy}
                onClick={() => onAction(action)}
              >
                {COPY[`workflow.action.${action}`]}
              </Button>
            ))}
          </span>
        ) : null}
      </footer>
    </section>
  );
}
