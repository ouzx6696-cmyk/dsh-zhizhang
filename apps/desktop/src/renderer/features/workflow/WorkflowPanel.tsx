import React, { useEffect, useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Empty, Notice } from "@zhizhang/ui/primitives";
import type { RunDetail, RunSummary, Target, WorkflowAction } from "../../../shared/views";
import { askConfirm } from "../../state/confirm";
import { desktop } from "../../state/desktop";
import { sameTarget } from "../../state/store";
import { errorText, notifyError } from "../../format";
import { decideRun } from "./decide";
import { RunCard } from "./RunCard";
import { RunDetailView } from "./RunDetailView";
import { RunHistory } from "./RunHistory";
import { StartForm } from "./StartForm";
import { isOpen, newer, requestField } from "./workflow-model";

/** 右栏“流水线”：发起 → 阶段进度 → 等你决定；历史运行可点开只读详情（D13）。 */
export function WorkflowPanel({ target, compact = false }: { target: Target; compact?: boolean }) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [current, setCurrent] = useState<RunSummary | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [viewing, setViewing] = useState<RunSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    desktop
      .runHistory(target)
      .then((list) => {
        if (!alive) return;
        const sorted = [...list].sort((a, b) => b.created.localeCompare(a.created));
        setRuns(sorted);
        setCurrent((prev) => prev ?? sorted[0] ?? null);
      })
      .catch((err: unknown) => alive && setError(errorText(err)));
    const off = desktop.subscribe((event) => {
      if (event.kind !== "run" || !sameTarget(event.target, target)) return;
      setCurrent((prev) => newer(prev, event.run));
      setRuns((prev) => [event.run, ...prev.filter((r) => r.id !== event.run.id)]);
    });
    return () => {
      alive = false;
      off();
    };
  }, [target]);

  const currentId = current?.id ?? "";
  useEffect(() => {
    if (!currentId) return setDetail(null);
    let alive = true;
    desktop
      .getRun({ runId: currentId, target })
      .then((value) => alive && setDetail(value))
      .catch(notifyError);
    return () => {
      alive = false;
    };
  }, [currentId, target]);

  const act = async (task: () => Promise<RunSummary>) => {
    setBusy(true);
    try {
      const next = await task();
      setCurrent((prev) => newer(prev, next));
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const onAction = (action: WorkflowAction) => {
    if (!current) return;
    const ref = { runId: current.id, target };
    void (async () => {
      if (action === "stop" && !(await askConfirm(C.workflow.stopConfirm))) return;
      await act(() => desktop.controlRun(ref, action));
    })();
  };

  const onDecide = (decision: "apply" | "discard") => {
    if (!current) return;
    const chapter = requestField(detail, "chapterId");
    void act(() => decideRun(target, current, chapter, decision, null));
  };

  // 查看的运行被新事件更新时保持同步，避免详情页停留在旧状态。
  const viewed = viewing ? (runs.find((r) => r.id === viewing.id) ?? viewing) : null;

  return (
    <div className="zz-workflow" data-testid="workflow-panel">
      {error ? <Notice tone="bad" message={error} /> : null}
      {viewed ? (
        <RunDetailView run={viewed} target={target} onBack={() => setViewing(null)} />
      ) : (
        <>
          {current ? (
            <RunCard
              run={current}
              detail={detail}
              busy={busy}
              onAction={onAction}
              onDecide={onDecide}
              compact={compact}
            />
          ) : null}
          {!current ? <Empty title={C.workflow.empty} description={C.workflow.emptyHint} /> : null}
          {!current || !isOpen(current.state) ? (
            <StartForm target={target} onStarted={setCurrent} />
          ) : null}
          <RunHistory runs={runs} currentId={currentId} onOpen={(run) => setViewing(run)} />
        </>
      )}
    </div>
  );
}
