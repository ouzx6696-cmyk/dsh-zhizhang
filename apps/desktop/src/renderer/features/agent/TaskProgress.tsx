import React, { useEffect, useState } from "react";
import type { TaskState } from "../../../renderer-contracts";
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
  const actionTitle = (text: string) =>
    text
      .replace(/^【写作台】/, "")
      .split(/[。\n]/)[0]
      .slice(0, 44);
  return (
    <>
      {task && (
        <section className="task-card" aria-label="当前任务">
          <header>
            <strong>
              {busy ? "正在进行" : "任务结束"} ·{" "}
              {task.name?.startsWith("【写作台】") ? actionTitle(task.name) : task.name || phase}
            </strong>
            <button
              className="stop-task"
              disabled={!busy}
              aria-label="停止任务"
              onClick={() => onStop()}
            >
              停止
            </button>
          </header>
          <div className="lamp-task-meta">
            <span>{task.current}</span>
            {task.startedAt > 0 && (busy || task.endedAt) && (
              <span>
                已用 {Math.max(0, Math.floor(((task.endedAt ?? now) - task.startedAt) / 1000))} 秒
              </span>
            )}
            {task.cost > 0 && <span>估算 ${task.cost.toFixed(4)}</span>}
          </div>
          <div className="task-track">
            {steps.map((step) => (
              <span
                key={step}
                title={step}
                className={
                  task.completed?.includes(step) ? "done" : task.current === step ? "current" : ""
                }
              />
            ))}
          </div>
          <p>
            {task.completed?.length ? "已完成：" + task.completed.join(" → ") + " · " : ""}
            {busy ? "当前：" + (task.current || phase) : task.waiting}
          </p>
        </section>
      )}
    </>
  );
}
