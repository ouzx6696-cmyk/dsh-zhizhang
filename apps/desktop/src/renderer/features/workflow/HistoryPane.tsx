import React, { useEffect, useId, useState } from "react";
import { ArrowLeft, ChevronRight } from "lucide-react";
import {
  COPY as copy,
  formatCost,
  formatDateTime,
  formatElapsed,
  formatTokens,
  WORKFLOW_COPY,
} from "../../../../../../packages/ui/src/copy.js";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import type { WorkflowRecord } from "../../../../../../packages/core/src/workflow-config.js";
import { desktop } from "../../state/desktop";
import { scopeId, type Target } from "../../../context";
import { DraftCompare } from "./DraftCompare";
import { RunStats } from "./RunOverview";
import { StageTimeline } from "./StageTimeline";
import { KIND_LABEL, STATE_LABEL, spanElapsed, sumUsage } from "./workflow-model";
import "../../../styles/workflow-history.css";

/** 一组记录的用量合计，缓存读取占比按输入口径计算。 */
function Totals({ label, rows }: { label: string; rows: WorkflowRecord[] }) {
  const usage = sumUsage(rows.flatMap((row) => row.steps)),
    input = usage.input + usage.cacheRead;
  return (
    <div>
      <dt>{label}</dt>
      <dd>{formatTokens(usage)}</dd>
      <dd>
        {formatCost(usage.cost)} · {copy.workflowCacheRate}{" "}
        {input ? ((usage.cacheRead / input) * 100).toFixed(1) : "0"}%
      </dd>
    </div>
  );
}

/** 历史记录不再运行，耗时以最后保存时间为准，不会走秒。 */
const settledAt = (record: WorkflowRecord) => Date.parse(record.updated);

function HistoryItem({ record, onOpen }: { record: WorkflowRecord; onOpen: () => void }) {
  const { kind, chapter, instruction } = record.request;
  return (
    <li>
      <button type="button" className="wf-history-item" onClick={onOpen}>
        <span className="wf-history-line">
          <span className="wf-chip" data-state={record.state}>
            {STATE_LABEL[record.state]}
          </span>
          <span>
            {KIND_LABEL[kind]}
            {(kind === "chapter" || kind === "ledger") && ` · ${chapter}`}
          </span>
          <time dateTime={record.created}>{formatDateTime(record.created)}</time>
        </span>
        <span className="wf-history-instruction">{instruction}</span>
        <span className="wf-history-meta">
          {WORKFLOW_COPY.historyStages(record.steps.length)} ·{" "}
          {formatElapsed(spanElapsed(record.steps, record, settledAt(record)))} ·{" "}
          {formatCost(sumUsage(record.steps).cost)}
        </span>
        <ChevronRight size={14} aria-hidden="true" className="wf-history-chevron" />
        <span className="wb-visually-hidden">{WORKFLOW_COPY.historyOpen}</span>
      </button>
    </li>
  );
}

function HistoryDetail({ record, onBack }: { record: WorkflowRecord; onBack: () => void }) {
  return (
    <article className="wf-history-detail">
      <button type="button" className="wf-quiet" onClick={onBack}>
        <ArrowLeft size={14} aria-hidden="true" />
        {WORKFLOW_COPY.historyBack}
      </button>
      <header className="wf-overview-head">
        <span className="wf-chip" data-state={record.state}>
          {STATE_LABEL[record.state]}
        </span>
        <span className="wf-overview-kind">
          {KIND_LABEL[record.request.kind]} · {formatDateTime(record.created)}
        </span>
      </header>
      <p className="wf-overview-instruction">{record.request.instruction}</p>
      {record.error && <p className="wf-notice-raw">{record.error}</p>}
      <RunStats record={record} now={settledAt(record)} />
      <StageTimeline record={record} now={settledAt(record)} />
      <DraftCompare record={record} />
    </article>
  );
}

/** 本作品的历史任务：先看摘要列表，点开看与当前任务同样格式的阶段详情。 */
export function HistoryPane({
  target,
  revision,
  onError,
}: {
  target: Target;
  /** 记录 id + 状态：阶段逐次保存不变，只在开始、暂停、失败、等待作者时重新读取历史。 */
  revision: string;
  onError: (text: string) => void;
}) {
  const [rows, setRows] = useState<WorkflowRecord[]>([]),
    [selected, setSelected] = useState<string | null>(null);
  const heading = useId(),
    key = scopeId(target);
  useEffect(() => {
    let alive = true;
    desktop
      .workflowHistory(target)
      .then((value) => {
        if (alive) setRows(value);
      })
      .catch((error) => {
        if (alive) onError(errorText(error));
      });
    return () => {
      alive = false;
    };
  }, [key, revision, onError]); // eslint-disable-line react-hooks/exhaustive-deps
  // 按本地时区划分月份：月初几个小时的任务不该被算进上个月。
  const monthOf = (iso: string) => formatDateTime(iso).slice(0, 7),
    month = monthOf(new Date().toISOString());
  const open = rows.find((row) => row.id === selected);
  return (
    <section className="wf-history" aria-labelledby={heading}>
      <h3 id={heading}>{copy.workflowHistory}</h3>
      <dl className="wf-history-totals">
        <Totals label={copy.workflowTotal} rows={rows} />
        <Totals
          label={copy.workflowMonth}
          rows={rows.filter((row) => monthOf(row.created) === month)}
        />
      </dl>
      {open ? (
        <HistoryDetail record={open} onBack={() => setSelected(null)} />
      ) : rows.length ? (
        <ul className="wf-history-list">
          {rows.map((row) => (
            <HistoryItem key={row.id} record={row} onOpen={() => setSelected(row.id)} />
          ))}
        </ul>
      ) : (
        <p className="wf-hint">{WORKFLOW_COPY.historyEmpty}</p>
      )}
    </section>
  );
}
