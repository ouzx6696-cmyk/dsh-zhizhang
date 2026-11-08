import React, { useEffect, useState } from "react";
import { COPY as copy } from "../../../../../../packages/ui/src/copy.js";
import { errorText } from "../../../../../../packages/core/src/errors.js";
import { desktop } from "../../state/desktop";
import type { Target } from "../../../context";
import type { WorkflowRecord } from "../../../../../../packages/core/src/workflow-config.js";
function totals(rows: WorkflowRecord[]) {
  const steps = rows.flatMap((row) => row.steps),
    input = steps.reduce((sum, row) => sum + row.usage.input, 0),
    cache = steps.reduce((sum, row) => sum + row.usage.cacheRead, 0),
    output = steps.reduce((sum, row) => sum + row.usage.output, 0);
  const used = steps.filter(
    (row) => row.usage.input + row.usage.output + row.usage.cacheRead + row.usage.cacheWrite > 0,
  );
  const cost = used.some((row) => row.usage.cost === null)
    ? copy.workflowUnknown
    : used.reduce((sum, row) => sum + (row.usage.cost ?? 0), 0).toFixed(6);
  return `${copy.workflowInput} ${input} · ${copy.workflowOutput} ${output} · ${copy.workflowCacheRate} ${input + cache ? ((cache / (input + cache)) * 100).toFixed(1) : 0}% · ${copy.workflowCost} ${cost}`;
}
export function HistoryPane({
  target,
  revision,
  onError,
  onSelect,
}: {
  target: Target;
  /** 记录 id + 状态：阶段逐次保存不变，只在开始、暂停、失败、等待作者时重新读取历史。 */
  revision: string;
  onError: (text: string) => void;
  onSelect: (record: WorkflowRecord) => void;
}) {
  const [rows, setRows] = useState<WorkflowRecord[]>([]);
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
  }, [target, revision, onError]);
  return (
    <section>
      <h3>{copy.workflowHistory}</h3>
      <p>
        {copy.workflowTotal}：{totals(rows)}
      </p>
      <p>
        {copy.workflowMonth}：
        {totals(
          rows.filter((row) => row.created.slice(0, 7) === new Date().toISOString().slice(0, 7)),
        )}
      </p>
      {rows.map((row) => (
        <p key={row.id}>
          <button onClick={() => onSelect(row)}>
            {row.created.slice(0, 16)} · {row.request.kind} · {row.request.chapter} · {row.state}
          </button>
        </p>
      ))}
    </section>
  );
}
