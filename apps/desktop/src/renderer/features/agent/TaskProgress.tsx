import {
  COPY as viewCopy,
  formatCost,
  formatElapsed,
  formatTokens,
  AGENT_COPY,
} from "@writer/ui/copy";
import { actionTitle } from "../../format";
import React, { useEffect, useState } from "react";
import { Square } from "lucide-react";
import type { TaskState } from "../../../renderer-contracts";

function stepState(task: TaskState, step: string) {
  if (task.completed.includes(step)) return "done";
  return task.current === step ? "current" : "pending";
}

const STEP_LABEL = {
  done: AGENT_COPY.stepDone,
  current: AGENT_COPY.stepCurrent,
  pending: AGENT_COPY.stepPending,
};

export function TaskProgress({
  task,
  busy,
  phase,
  steps,
  queued,
  onStop,
}: {
  task: TaskState | null;
  busy: boolean;
  phase: string;
  steps: string[];
  queued: number;
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy, task?.id]);
  if (!task) return null;
  return (
    <section
      className="task-card"
      data-state={busy ? "running" : "ended"}
      aria-label={viewCopy.taskProgressText1}
    >
      <header>
        <strong>
          {busy ? viewCopy.taskProgressText2 : viewCopy.taskProgressText3} ·{" "}
          {task.name.startsWith(viewCopy.agentPanelText30)
            ? actionTitle(task.name)
            : task.name || phase}
        </strong>
        <button
          className="stop-task"
          disabled={!busy}
          aria-label={viewCopy.taskProgressText4}
          onClick={() => onStop()}
        >
          <Square size={11} aria-hidden="true" />
          {viewCopy.taskProgressText5}
        </button>
      </header>
      <div className="lamp-task-meta">
        {task.startedAt > 0 && (busy || task.endedAt) && (
          <span>
            {viewCopy.taskProgressText6}
            {formatElapsed((task.endedAt ?? now) - task.startedAt)}
          </span>
        )}
        {task.usage && <span>{formatTokens(task.usage)}</span>}
        {task.cost > 0 && <span>{AGENT_COPY.estimated + formatCost(task.cost)}</span>}
        {queued > 0 && (
          <span className="task-card-queued">
            {AGENT_COPY.queuedCount + queued + AGENT_COPY.queuedUnit}
          </span>
        )}
      </div>
      <ol className="task-track" aria-label={viewCopy.taskProgressText1}>
        {steps.map((step) => {
          const state = stepState(task, step);
          return (
            <li key={step} title={step} data-state={state}>
              <span className="agent-sr-only">
                {step}：{STEP_LABEL[state]}
              </span>
            </li>
          );
        })}
      </ol>
      <p role="status" aria-atomic="true">
        {task.completed.length
          ? viewCopy.taskProgressText9 + task.completed.join(" → ") + " · "
          : ""}
        {busy ? viewCopy.taskProgressText10 + (task.current || phase) : task.waiting}
      </p>
    </section>
  );
}
