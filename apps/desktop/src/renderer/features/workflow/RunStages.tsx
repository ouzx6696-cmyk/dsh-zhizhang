import React from "react";
import { Check } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Spinner } from "@zhizhang/ui/primitives";
import type { RunSummary } from "../../../shared/views";
import {
  progressGroups,
  progressIndex,
  stageGroup,
  stageRows,
  type StageRow,
} from "./workflow-model";

/** 分屏（≥1600）时右栏上半只够放进度与决定：任务不在运行时，阶段明细折叠成一行。 */
export function StageSection({ run, compact }: { run: RunSummary; compact: boolean }) {
  if (!compact || run.state === "running") return <StageList run={run} />;
  return (
    <details className="zz-stage-details" data-testid="workflow-stage-details">
      <summary>{C.workflow.stagesSummary(stageRows(run.stages).length)}</summary>
      <StageList run={run} />
    </details>
  );
}

export function StageList({ run }: { run: RunSummary }) {
  const groups = progressGroups(run.kind);
  const rows = stageRows(run.stages);
  const live = run.state === "running";
  const current = progressIndex(run);
  if (!groups.length)
    return (
      <ol className="zz-stages" aria-label={C.workflow.stages}>
        {rows.map((row) => (
          <StageItem key={row.key} row={row} />
        ))}
        {live ? <LiveItem /> : null}
      </ol>
    );
  return (
    <div className="zz-stage-groups" aria-label={C.workflow.stages} role="group">
      {groups.map((label, index) => {
        const members = rows.filter((row) => stageGroup(run.kind, row.ids[0]) === index);
        const state =
          index < current || run.state === "awaiting-author" || run.state === "applied"
            ? "done"
            : index === current
              ? run.state === "failed"
                ? "failed"
                : live
                  ? "current"
                  : "paused"
              : "todo";
        return (
          <section key={label} className="zz-stage-group" data-state={state}>
            <h4 className="zz-stage-group__head">
              <span className="zz-stage-group__mark" aria-hidden="true" />
              {label}
            </h4>
            {members.length || (state === "current" && live) ? (
              <ol className="zz-stages">
                {members.map((row) => (
                  <StageItem key={row.key} row={row} />
                ))}
                {state === "current" && live ? <LiveItem /> : null}
              </ol>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

export function StageItem({ row }: { row: StageRow }) {
  return (
    <li
      className="zz-stage"
      data-testid="workflow-stage"
      data-stage={row.ids.join(" ")}
      data-phase="done"
    >
      <Check size={13} aria-hidden="true" className="zz-stage__icon" />
      <span className="zz-stage__label">{row.label}</span>
      {row.marks.length ? <span className="zz-stage__marks">{row.marks.join(" · ")}</span> : null}
    </li>
  );
}

function LiveItem() {
  return (
    <li
      className="zz-stage zz-stage--live"
      data-testid="workflow-stage"
      data-stage=""
      data-phase="running"
    >
      <Spinner size="sm" label={C.workflow.live} className="zz-stage__icon" />
      <span className="zz-stage__label">{C.workflow.live}</span>
    </li>
  );
}

export function ProgressTrack({ run }: { run: RunSummary }) {
  const groups = progressGroups(run.kind);
  if (!groups.length) return null;
  const current = progressIndex(run);
  return (
    <div
      className="zz-track"
      data-testid="workflow-progress"
      data-step={current}
      data-total={groups.length}
      data-state={run.state}
      role="progressbar"
      aria-label={C.workflow.progress}
      aria-valuemin={0}
      aria-valuemax={groups.length}
      aria-valuenow={Math.min(current, groups.length)}
      aria-valuetext={groups[Math.min(current, groups.length - 1)]}
    >
      {groups.map((label, index) => (
        <span
          key={label}
          className="zz-track__step"
          data-state={index < current ? "done" : index === current ? "current" : "todo"}
        >
          <i className="zz-track__seg" aria-hidden="true" />
          <span className="zz-track__label">{label}</span>
        </span>
      ))}
    </div>
  );
}
