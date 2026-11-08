import React, { useCallback, useEffect, useId, useRef, useState } from "react";
import { Maximize2, Minimize2, PanelRightClose, Workflow, X } from "lucide-react";
import {
  COPY as copy,
  formatElapsed,
  WORKFLOW_COPY,
} from "../../../../../../packages/ui/src/copy.js";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import type {
  WorkflowRecord,
  WorkflowRequest,
  EngineSettings,
} from "../../../../../../packages/core/src/workflow-config.js";
import { scopeId, type Target, type Focus } from "../../../context";
import { desktop, onDesktopEvent } from "../../state/desktop";
import { desktopStore } from "../../state/store";
import { askConfirm } from "../../state/confirm";
import { PersonalPane } from "./PersonalPane";
import { HistoryPane } from "./HistoryPane";
import { ContinuityPane } from "./ContinuityPane";
import { RunOverview, type RunAction } from "./RunOverview";
import { PhaseIcon, StageTimeline } from "./StageTimeline";
import { DraftCompare } from "./DraftCompare";
import { TaskForm } from "./TaskForm";
import { TabList, tabPanelProps } from "../../../../../../packages/ui/src/tabs";
import {
  STATE_LABEL,
  selectedCandidate,
  spanElapsed,
  stageProgress,
  stageRows,
  type Phase,
} from "./workflow-model";

/** 只在流水线运行时每秒走一次，其余时间不重绘。 */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

const PILL_PHASE: Record<WorkflowRecord["state"], Phase> = {
  running: "running",
  paused: "paused",
  failed: "failed",
  "awaiting-author": "complete",
};

function PillMeta({ record, now }: { record: WorkflowRecord; now: number }) {
  const { done, total } = stageProgress(stageRows(record));
  return (
    <span className="wf-pill-meta">
      {STATE_LABEL[record.state]} · {WORKFLOW_COPY.stageCount(done, total)} ·{" "}
      {formatElapsed(spanElapsed(record.steps, record, now))}
    </span>
  );
}

/** 收起后的角标：只显示状态、阶段数与用时，点一下展开。 */
function Pill({
  record,
  now,
  onExpand,
  pillRef,
}: {
  record: WorkflowRecord | null;
  now: number;
  onExpand: () => void;
  pillRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={pillRef}
      type="button"
      className="wf-pill"
      data-state={record?.state}
      title={WORKFLOW_COPY.expand}
      onClick={onExpand}
    >
      {record ? (
        <PhaseIcon phase={PILL_PHASE[record.state]} />
      ) : (
        <Workflow size={16} aria-hidden="true" />
      )}
      <span>{copy.workflowTitle}</span>
      {record && <PillMeta record={record} now={now} />}
    </button>
  );
}

/**
 * 非模态的停靠面板：作者边看正文边看进度。Esc 收起到角落而不是关闭，
 * 关闭按钮才卸载面板；运行中的流水线不受面板开合影响。
 */
export function WorkflowPanel({
  target,
  focus,
  engine,
  onClose,
  onNavigate,
}: {
  target: Target;
  focus: Focus;
  engine: EngineSettings;
  onClose: () => void;
  onNavigate: (target: Target, focus: Focus) => Promise<void>;
}) {
  const [value, setValue] = useState<WorkflowRecord | null>(null),
    [error, setError] = useState(""),
    [tab, setTab] = useState("task"),
    [busy, setBusy] = useState(false),
    [dismissed, setDismissed] = useState<string | null>(null),
    [collapsed, setCollapsed] = useState(false),
    [wide, setWide] = useState(false);
  const [request, setRequest] = useState<WorkflowRequest>({
    kind: target.mode === "toutiao" ? "article" : "chapter",
    chapter: focus.chapter ?? "",
    instruction: "",
    grade: engine.grade,
    source: "",
    line: "news",
  });
  const base = useId(),
    heading = useRef<HTMLHeadingElement>(null),
    pill = useRef<HTMLButtonElement>(null);
  const key = scopeId(target);
  useEffect(() => {
    let alive = true;
    desktop
      .workflow(target, "status")
      .then((value) => {
        if (alive) {
          setValue(value);
          if (value) setRequest(value.request);
        }
      })
      .catch((error) => {
        if (alive) setError(errorText(error));
      });
    const off = onDesktopEvent((event) => {
      if (event.workflow && scopeId(event.target) === key) setValue(event.workflow);
    });
    return () => {
      alive = false;
      off();
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    (collapsed ? pill : heading).current?.focus();
  }, [collapsed]);
  const active = value && value.id !== dismissed ? value : null;
  const now = useNow(value?.state === "running");
  const run = async (action: RunAction | "start") => {
    setError("");
    setBusy(true);
    try {
      setValue(await desktop.workflow(target, action, action === "start" ? request : undefined));
      return true;
    } catch (error) {
      setError(errorText(error));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const cancel = async (record: WorkflowRecord) => {
    const confirmed = await askConfirm({
      message: WORKFLOW_COPY.cancelConfirm,
      confirmLabel: WORKFLOW_COPY.cancel,
      cancelLabel: WORKFLOW_COPY.keepRunning,
    });
    if (confirmed && (await run("pause"))) setDismissed(record.id);
  };
  const viewCandidate = (record: WorkflowRecord) => {
    void onNavigate(target, {
      chapter: record.request.chapter,
      source: "candidate",
      candidate: selectedCandidate(record),
    }).catch((error) => setError(errorText(error)));
  };
  const onError = useCallback((message: string) => setError(message), []);
  const tabs = [
    { id: "task", label: copy.workflowTaskTab },
    ...(target.mode === "fanqie" ? [{ id: "state", label: copy.workflowStateTab }] : []),
    { id: "personal", label: copy.workflowPersonalTab },
  ];
  return (
    <>
      <section
        className="wf-dock"
        data-wide={wide}
        hidden={collapsed}
        role="dialog"
        aria-modal="false"
        aria-labelledby={`${base}-title`}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          setCollapsed(true);
        }}
      >
        <header className="wf-dock-head">
          <h2 id={`${base}-title`} ref={heading} tabIndex={-1}>
            {copy.workflowTitle}
          </h2>
          <button
            type="button"
            className="icon-button"
            aria-label={wide ? WORKFLOW_COPY.narrow : WORKFLOW_COPY.widen}
            title={wide ? WORKFLOW_COPY.narrow : WORKFLOW_COPY.widen}
            onClick={() => setWide(!wide)}
          >
            {wide ? (
              <Minimize2 size={16} aria-hidden="true" />
            ) : (
              <Maximize2 size={16} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={WORKFLOW_COPY.collapse}
            title={WORKFLOW_COPY.collapse}
            onClick={() => setCollapsed(true)}
          >
            <PanelRightClose size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={copy.close}
            title={copy.close}
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </header>
        <TabList
          id={base}
          className="wf-tabs"
          label={WORKFLOW_COPY.views}
          items={tabs}
          value={tab}
          onChange={setTab}
        />
        {error && (
          <p role="alert" className="wf-error">
            {error}
          </p>
        )}
        <div {...tabPanelProps(base, tab, tab)} tabIndex={0} className="wf-dock-body">
          {tab === "task" && (
            <>
              {active ? (
                <>
                  <RunOverview
                    record={active}
                    now={now}
                    engine={engine}
                    busy={busy}
                    onAction={(action) => void run(action)}
                    onCancel={() => void cancel(active)}
                    onDismiss={() => setDismissed(active.id)}
                    onOpenSettings={() => desktopStore.set({ settingsOpen: true })}
                    onViewCandidate={() => viewCandidate(active)}
                  />
                  <StageTimeline
                    record={active}
                    now={now}
                    onRetry={
                      active.state === "failed" && !busy ? () => void run("resume") : undefined
                    }
                  />
                  <DraftCompare record={active} />
                </>
              ) : (
                <>
                  {value ? (
                    <p className="wf-hint wf-previous">
                      {value.state === "awaiting-author"
                        ? WORKFLOW_COPY.previousDone
                        : WORKFLOW_COPY.previousStopped}
                      <button type="button" className="wf-quiet" onClick={() => setDismissed(null)}>
                        {WORKFLOW_COPY.backToPrevious}
                      </button>
                    </p>
                  ) : (
                    <p className="wf-hint">{copy.workflowNoTask}</p>
                  )}
                  <TaskForm
                    target={target}
                    request={request}
                    setRequest={setRequest}
                    busy={busy}
                    onStart={() => void run("start")}
                    onError={onError}
                  />
                </>
              )}
              <HistoryPane
                target={target}
                revision={value ? value.id + ":" + value.state : ""}
                onError={onError}
              />
            </>
          )}
          {tab === "state" && <ContinuityPane target={target} onError={onError} />}
          {tab === "personal" && <PersonalPane target={target} onError={onError} />}
        </div>
      </section>
      {collapsed && (
        <Pill record={active} now={now} onExpand={() => setCollapsed(false)} pillRef={pill} />
      )}
    </>
  );
}
