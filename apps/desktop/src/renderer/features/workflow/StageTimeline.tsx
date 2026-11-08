import React, { useId, useState } from "react";
import {
  ChevronRight,
  CircleCheck,
  CircleDashed,
  CirclePause,
  CircleX,
  LoaderCircle,
  RotateCcw,
  type LucideIcon,
} from "lucide-react";
import {
  WORKFLOW_COPY,
  formatCost,
  formatElapsed,
  formatTokens,
} from "../../../../../../packages/ui/src/copy.js";
import {
  hasUsage,
  type WorkflowRecord,
} from "../../../../../../packages/core/src/workflow-config.js";
import { StageOutput } from "./StageOutput";
import {
  rowElapsed,
  stageRows,
  stepPhase,
  sumUsage,
  type Phase,
  type StageRow,
} from "./workflow-model";
import "../../../styles/workflow-stages.css";

const PHASE_ICON: Record<Phase, LucideIcon> = {
  waiting: CircleDashed,
  running: LoaderCircle,
  complete: CircleCheck,
  failed: CircleX,
  paused: CirclePause,
};

export function PhaseIcon({ phase }: { phase: Phase }) {
  const Icon = PHASE_ICON[phase];
  return (
    <Icon
      size={16}
      aria-hidden="true"
      className={phase === "running" ? "wf-stage-icon spin" : "wf-stage-icon"}
      data-phase={phase}
    />
  );
}

function usageText(row: StageRow) {
  const usage = sumUsage(row.steps);
  if (hasUsage(usage)) return `${formatTokens(usage)} · ${formatCost(usage.cost)}`;
  const local = row.phase === "complete" && row.steps.every((step) => step.model === undefined);
  return local ? WORKFLOW_COPY.localStep : "";
}

function StageItem({
  row,
  record,
  now,
  open,
  onToggle,
  onRetry,
}: {
  row: StageRow;
  record: WorkflowRecord;
  now: number;
  open: boolean;
  onToggle: () => void;
  onRetry?: () => void;
}) {
  const body = useId();
  const errors = row.steps.flatMap((step) => (step.error ? [step.error] : []));
  const meta = usageText(row);
  return (
    <li className="wf-stage" data-phase={row.phase}>
      <button
        type="button"
        className="wf-stage-head"
        aria-expanded={open}
        aria-controls={body}
        onClick={onToggle}
      >
        <PhaseIcon phase={row.phase} />
        <span className="wf-stage-title">
          {row.title}
          <span className="wb-visually-hidden"> · {WORKFLOW_COPY.phase[row.phase]}</span>
        </span>
        <span className="wf-stage-time">{formatElapsed(rowElapsed(row, record, now))}</span>
        <ChevronRight size={14} aria-hidden="true" className="wf-stage-chevron" />
        {meta && <span className="wf-stage-meta">{meta}</span>}
      </button>
      {row.phase === "failed" && errors.length > 0 && (
        <div className="wf-stage-error">
          <p>{errors.at(-1)}</p>
          {onRetry && (
            <button type="button" onClick={onRetry}>
              <RotateCcw size={14} aria-hidden="true" />
              {WORKFLOW_COPY.retry}
            </button>
          )}
        </div>
      )}
      {open && (
        <div id={body} className="wf-stage-body">
          {row.steps.length === 1 ? (
            <StageOutput step={row.steps[0]} />
          ) : (
            row.steps.map((step, index) => (
              <section key={step.id} className="wf-stage-part">
                <h5>
                  <PhaseIcon phase={stepPhase(step, record)} />
                  {WORKFLOW_COPY.vote(index)}
                </h5>
                <StageOutput step={step} />
              </section>
            ))
          )}
        </div>
      )}
    </li>
  );
}

/** 阶段时间线：每阶段一行，展开看结构化产出；运行中阶段由外部传入的 now 走秒。 */
export function StageTimeline({
  record,
  now,
  onRetry,
}: {
  record: WorkflowRecord;
  now: number;
  onRetry?: () => void;
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(["delivery"]));
  const rows = stageRows(record);
  const preparing = record.state === "running" && !rows.some((row) => row.phase === "running");
  const toggle = (key: string) => {
    const next = new Set(open);
    if (!next.delete(key)) next.add(key);
    setOpen(next);
  };
  return (
    <ol className="wf-stages" aria-label={WORKFLOW_COPY.stages}>
      {rows.map((row) => (
        <StageItem
          key={row.key}
          row={row}
          record={record}
          now={now}
          open={open.has(row.key)}
          onToggle={() => toggle(row.key)}
          onRetry={onRetry}
        />
      ))}
      {preparing && (
        <li className="wf-stage" data-phase="waiting">
          <div className="wf-stage-head">
            <PhaseIcon phase="waiting" />
            <span className="wf-stage-title">{WORKFLOW_COPY.nextStage}</span>
          </div>
        </li>
      )}
    </ol>
  );
}
