import React from "react";
import { Pause, Play, RotateCcw, Square, TriangleAlert } from "lucide-react";
import {
  COPY as copy,
  formatCost,
  formatCount,
  formatElapsed,
  formatTokens,
  WORKFLOW_COPY,
} from "../../../../../../packages/ui/src/copy.js";
import type {
  EngineSettings,
  WorkflowRecord,
} from "../../../../../../packages/core/src/workflow-config.js";
import {
  KIND_LABEL,
  STATE_LABEL,
  canApply,
  deliveryOpen,
  inputTokens,
  spanElapsed,
  stageProgress,
  stageRows,
  stopReason,
  sumUsage,
} from "./workflow-model";
import "../../../styles/workflow-overview.css";

export type RunAction = "resume" | "pause" | "apply";

/** 进度条与用量合计；历史详情与当前任务共用。 */
export function RunStats({
  record,
  now,
  engine,
}: {
  record: WorkflowRecord;
  now: number;
  engine?: EngineSettings;
}) {
  const { done, total } = stageProgress(stageRows(record)),
    usage = sumUsage(record.steps);
  const ratio = record.state === "awaiting-author" ? 1 : total ? done / total : 0;
  const used = inputTokens(usage),
    share = engine ? used / engine.runBudget : 0;
  return (
    <div className="wf-stats">
      <div
        className="wf-stats-bar"
        role="progressbar"
        aria-label={WORKFLOW_COPY.progress}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={WORKFLOW_COPY.stageCount(done, total)}
        data-state={record.state}
      >
        <span style={{ transform: `scaleX(${ratio})` }} />
      </div>
      <dl className="wf-stats-grid">
        <div>
          <dt>{WORKFLOW_COPY.progress}</dt>
          <dd>{WORKFLOW_COPY.stageCount(done, total)}</dd>
        </div>
        <div>
          <dt>{WORKFLOW_COPY.elapsed}</dt>
          <dd>{formatElapsed(spanElapsed(record.steps, record, now))}</dd>
        </div>
        <div>
          <dt>{WORKFLOW_COPY.cost}</dt>
          <dd>{formatCost(usage.cost)}</dd>
        </div>
        <div className="wf-stats-wide">
          <dt>{WORKFLOW_COPY.usage}</dt>
          <dd>{formatTokens(usage)}</dd>
        </div>
        {engine && (
          <div className="wf-stats-wide" data-level={share >= 0.8 ? "high" : "normal"}>
            <dt>{WORKFLOW_COPY.budget}</dt>
            <dd>
              {Math.round(share * 100)}% ·{" "}
              {WORKFLOW_COPY.budgetDetail(formatCount(used), formatCount(engine.runBudget))}
              <span className="wf-stats-meter" aria-hidden="true">
                <span style={{ transform: `scaleX(${Math.min(1, share)})` }} />
              </span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function StopNotice({
  record,
  onOpenSettings,
}: {
  record: WorkflowRecord;
  onOpenSettings: () => void;
}) {
  const reason = stopReason(record),
    guide = reason ? WORKFLOW_COPY.guidance[reason] : undefined;
  // 中断与手动暂停的原文与引导是同一句话，不重复显示。
  const raw = reason !== "interrupted" && reason !== "stopped";
  return (
    <div
      className="wf-notice"
      data-tone={record.state === "failed" ? "danger" : guide?.settings ? "warning" : "info"}
      role="alert"
    >
      <strong>{guide ? guide.title : STATE_LABEL[record.state]}</strong>
      {guide && <p>{guide.body}</p>}
      {raw && <p className="wf-notice-raw">{record.error}</p>}
      {guide?.settings && (
        <button type="button" onClick={onOpenSettings}>
          {WORKFLOW_COPY.openSettings}
        </button>
      )}
    </div>
  );
}

/** 顶部总览：状态、进度与用量、阻塞说明，以及就近的操作。 */
export function RunOverview({
  record,
  now,
  engine,
  busy,
  onAction,
  onCancel,
  onDismiss,
  onOpenSettings,
  onViewCandidate,
}: {
  record: WorkflowRecord;
  now: number;
  engine: EngineSettings;
  busy: boolean;
  onAction: (action: RunAction) => void;
  onCancel: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
  onViewCandidate: () => void;
}) {
  const { kind, chapter, instruction } = record.request;
  return (
    <section className="wf-overview" aria-label={copy.workflowTitle}>
      <header className="wf-overview-head">
        <span className="wf-chip" data-state={record.state}>
          {STATE_LABEL[record.state]}
        </span>
        <span className="wf-overview-kind">
          {KIND_LABEL[kind]}
          {(kind === "chapter" || kind === "ledger") && ` · ${chapter}`}
        </span>
      </header>
      <p className="wf-overview-instruction" title={instruction}>
        {instruction}
      </p>
      <RunStats record={record} now={now} engine={engine} />
      {deliveryOpen(record) && (
        <div className="wf-notice" data-tone="warning" role="note">
          <strong>
            <TriangleAlert size={16} aria-hidden="true" />
            {WORKFLOW_COPY.unresolvedTitle}
          </strong>
          <p>{copy.workflowOpenIssues}</p>
        </div>
      )}
      {record.error && record.state !== "running" && (
        <StopNotice record={record} onOpenSettings={onOpenSettings} />
      )}
      <div className="wf-actions">
        {record.state === "running" && (
          <>
            <button type="button" disabled={busy} onClick={() => onAction("pause")}>
              <Pause size={14} aria-hidden="true" />
              {copy.workflowPause}
            </button>
            <button type="button" className="wf-danger" disabled={busy} onClick={onCancel}>
              <Square size={14} aria-hidden="true" />
              {WORKFLOW_COPY.cancel}
            </button>
          </>
        )}
        {record.state === "paused" && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onAction("resume")}
          >
            <Play size={14} aria-hidden="true" />
            {copy.workflowResume}
          </button>
        )}
        {record.state === "failed" && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onAction("resume")}
          >
            <RotateCcw size={14} aria-hidden="true" />
            {WORKFLOW_COPY.retry}
          </button>
        )}
        {record.state === "awaiting-author" && kind === "chapter" && (
          <button type="button" className="primary" onClick={onViewCandidate}>
            {copy.workflowViewCandidate}
          </button>
        )}
        {canApply(record) && (
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => onAction("apply")}
          >
            {kind === "book" ? copy.workflowApply : copy.workflowApplyArticle}
          </button>
        )}
        {record.state !== "running" && (
          <button type="button" className="wf-quiet" disabled={busy} onClick={onDismiss}>
            {record.state === "awaiting-author" ? copy.workflowStart : WORKFLOW_COPY.discard}
          </button>
        )}
      </div>
      {record.state === "failed" && <p className="wf-hint">{WORKFLOW_COPY.retryHint}</p>}
    </section>
  );
}
