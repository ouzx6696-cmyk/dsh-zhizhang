import React, { useState } from "react";
import { AlertTriangle, GitCompare, Hourglass, Pause, Play, RotateCcw, Square } from "lucide-react";
import { COPY, DESKTOP_COPY as C, ERROR_COPY, formatCost } from "@zhizhang/ui/copy";
import { Button, IconButton, Notice, StatusChip } from "@zhizhang/ui/primitives";
import type { RunDetail, RunSummary, WorkflowAction } from "../../../shared/views";
import { desktopStore, useDesktop } from "../../state/store";
import { WorkflowProgressTrack, WorkflowStageSection } from "./WorkflowStages";
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

function actionIcon(action: WorkflowAction) {
  switch (action) {
    case "pause":
      return <Pause size={13} />;
    case "resume":
      return <Play size={13} />;
    case "retry":
      return <RotateCcw size={13} />;
    case "stop":
      return <Square size={12} />;
  }
}

export function WorkflowRunView({
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
  const pendingBible = useDesktop((s) => s.selected?.pendingBible ?? 0);
  const [bibleDismissed, setBibleDismissed] = useState(false);

  const awaiting = run.state === "awaiting-author";
  const running = run.state === "running";
  const chapterAt = chapters.findIndex((c) => c.id === chapter);
  const chapterTitle = chapterAt >= 0 ? chapters[chapterAt].title : undefined;
  const candidate = hasCandidate(run.kind) && Boolean(chapter);
  const comparing = compare?.runId === run.id;
  const actions = runActions(run.state);
  const groups = progressGroups(run.kind);
  const at = Math.min(progressIndex(run), Math.max(groups.length - 1, 0));
  const stepNum = groups.length
    ? Math.min(progressIndex(run) + (running ? 1 : 0), groups.length)
    : 0;

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
        <div className="zz-run__head-right">
          <StatusChip tone={stateTone(run.state)} label={stateLabel(run.state)} dot />
          {actions.length ? (
            <span className="zz-run__icon-actions" role="group" aria-label={C.workflow.controls}>
              {actions.map((action) => (
                <IconButton
                  key={action}
                  size="xs"
                  variant="ghost"
                  label={COPY[`workflow.action.${action}`]}
                  data-testid={`workflow-${action}`}
                  disabled={busy}
                  icon={actionIcon(action)}
                  onClick={() => onAction(action)}
                />
              ))}
            </span>
          ) : null}
        </div>
      </header>

      <WorkflowProgressTrack run={run} />

      <div className="zz-run__meta">
        <span className="zz-run__usage" data-testid="workflow-usage">
          {groups.length
            ? C.rail.stepCounter(stepNum || 1, groups.length, formatCost(run.usage.cost))
            : formatCost(run.usage.cost)}
        </span>
      </div>

      {/* 读屏只宣告阶段级变化：当前分组与状态，不朗读用量数字。 */}
      <p className="zz-hidden-value" aria-live="polite">
        {groups.length && at >= 0
          ? C.workflow.groupLabel(stateLabel(run.state), groups[at])
          : stateLabel(run.state)}
      </p>

      {running && groups.length ? (
        <div className="zz-stage-active" data-testid="workflow-active-step">
          <div className="zz-stage-active__top">
            <span className="zz-stage-active__name">{groups[at]}</span>
            <span className="zz-stage-active__hint">{C.workflow.live}</span>
          </div>
          <span className="zz-stage-active__bar" aria-hidden="true">
            <i />
          </span>
        </div>
      ) : null}

      {pendingBible > 0 && !bibleDismissed ? (
        <div className="zz-bible-alert" role="status" data-testid="workflow-bible-alert">
          <div className="zz-bible-alert__head">
            <AlertTriangle size={13} aria-hidden="true" />
            <span>{C.rail.bibleAlertTitle(pendingBible)}</span>
          </div>
          <div className="zz-bible-alert__actions">
            <Button size="xs" variant="soft" onClick={() => desktopStore.set({ view: "bible" })}>
              {C.rail.bibleAlertGo}
            </Button>
            <Button size="xs" variant="text" onClick={() => setBibleDismissed(true)}>
              {C.rail.bibleAlertIgnore}
            </Button>
          </div>
        </div>
      ) : null}

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
                variant="decide"
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
                  variant="decide"
                  size="sm"
                  data-testid="workflow-adopt"
                  disabled={busy}
                  onClick={() => onDecide("apply")}
                >
                  {C.workflow.adopt}
                </Button>
                <Button
                  size="sm"
                  variant="text"
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

      <WorkflowStageSection run={run} compact={compact} />
    </section>
  );
}

export function WorkflowHistory({
  runs,
  currentId,
  onSelect,
}: {
  runs: RunSummary[];
  currentId: string;
  onSelect?: (run: RunSummary) => void;
}) {
  const past = runs.filter((r) => r.id !== currentId);
  if (!past.length) return null;
  return (
    <details className="zz-history" data-testid="workflow-history">
      <summary>{C.workflow.history(past.length)}</summary>
      <ul className="zz-history__list">
        {past.map((r) => (
          <li key={r.id} data-testid="workflow-history-item" data-state={r.state}>
            <button
              type="button"
              className="zz-history__btn"
              onClick={() => onSelect?.(r)}
              disabled={!onSelect}
            >
              <span className="zz-history__kind">{kindLabel(r.kind)}</span>
              <StatusChip tone={stateTone(r.state)} label={stateLabel(r.state)} />
              <span className="zz-history__time">
                {new Date(r.created).toLocaleString("zh-CN", {
                  hour12: false,
                  month: "numeric",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
