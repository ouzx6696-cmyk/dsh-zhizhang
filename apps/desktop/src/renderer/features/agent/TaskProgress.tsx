import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { actionTitle } from "../../format";
import React, { useEffect, useState } from "react";
import type { TaskState } from "../../../renderer-contracts";

/** 任务耗时：一分钟内按秒，超过后显示 m:ss，长任务一眼能读。 */
function elapsedLabel(seconds: number) {
  if (seconds < 60) return seconds + viewCopy.taskProgressText7;
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function TaskProgress({
  task,
  busy,
  phase,
  steps,
  onStop,
}: {
  task: TaskState | null;
  busy: boolean;
  phase: string;
  steps: string[];
  onStop: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!busy) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy, task?.id]);
  return (
    <>
      {task && (
        <section className="task-card" aria-label={viewCopy.taskProgressText1}>
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
              {viewCopy.taskProgressText5}
            </button>
          </header>
          <div className="lamp-task-meta">
            <span>{task.current}</span>
            {task.startedAt > 0 && (busy || task.endedAt) && (
              <span>
                {viewCopy.taskProgressText6}
                {elapsedLabel(
                  Math.max(0, Math.floor(((task.endedAt ?? now) - task.startedAt) / 1000)),
                )}
              </span>
            )}
            {task.cost > 0 && (
              <span>
                {viewCopy.taskProgressText8}
                {task.cost.toFixed(4)}
              </span>
            )}
          </div>
          <div className="task-track">
            {steps.map((step) => (
              <span
                key={step}
                title={step}
                className={
                  task.completed.includes(step) ? "done" : task.current === step ? "current" : ""
                }
              />
            ))}
          </div>
          <p>
            {task.completed.length
              ? viewCopy.taskProgressText9 + task.completed.join(" → ") + " · "
              : ""}
            {busy ? viewCopy.taskProgressText10 + (task.current || phase) : task.waiting}
          </p>
        </section>
      )}
    </>
  );
}
