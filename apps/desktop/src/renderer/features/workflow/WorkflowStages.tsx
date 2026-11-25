import React from "react";
import { Check } from "lucide-react";
import { DESKTOP_COPY as C, formatCost } from "@zhizhang/ui/copy";
import { Spinner } from "@zhizhang/ui/primitives";
import type { RunSummary } from "../../../shared/views";
import {
  progressGroups,
  progressIndex,
  stageGroup,
  stageRows,
  type StageRow,
} from "./workflow-model";

function StageItem({ row }: { row: StageRow }) {
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

function StageList({ run }: { run: RunSummary }) {
  const groups = progressGroups(run.kind);
  const rows = stageRows(run.stages);
  const live = run.state === "running";
  const current = progressIndex(run);
  if (!groups.length) {
    return (
      <ol className="zz-stages" aria-label={C.workflow.stages}>
        {rows.map((row) => (
          <StageItem key={row.key} row={row} />
        ))}
        {live ? <LiveItem /> : null}
      </ol>
    );
  }
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

/** 柔和纸面 C2：已完成步骤默认折叠成一行「已完成 N 步 · ¥x.xx」，待裁决时保持展开便于审阅。 */
export function WorkflowStageSection({ run, compact }: { run: RunSummary; compact: boolean }) {
  const count = stageRows(run.stages).length;
  if (!compact && run.state === "running") return <StageList run={run} />;
  return (
    <details
      className="zz-stage-details"
      data-testid="workflow-stage-details"
      open={run.state === "awaiting-author"}
    >
      <summary>
        {count > 0
          ? C.rail.completedSteps(count, formatCost(run.usage.cost))
          : C.workflow.stagesSummary(count)}
      </summary>
      <StageList run={run} />
    </details>
  );
}

export function WorkflowProgressTrack({ run }: { run: RunSummary }) {
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
      {groups.map((label, index) => {
        const done = index < current || run.state === "applied";
        const isCurrent = !done && index === current;
        const stepState = done
          ? "done"
          : isCurrent
            ? run.state === "failed"
              ? "failed"
              : run.state === "paused"
                ? "warn"
                : run.state === "running"
                  ? "running"
                  : "current"
            : "todo";
        return (
          <span key={label} className="zz-track__step" data-state={stepState}>
            <i className="zz-track__seg" aria-hidden="true" />
            <span className="zz-track__label">{label}</span>
          </span>
        );
      })}
    </div>
  );
}
