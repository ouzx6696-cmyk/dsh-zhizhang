import React from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { StatusChip } from "@zhizhang/ui/primitives";
import type { RunSummary } from "../../../shared/views";
import { kindLabel, stateLabel, stateTone } from "./workflow-model";

function timeOf(created: string): string {
  return new Date(created).toLocaleString("zh-CN", {
    hour12: false,
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** 历史运行列表：每行是按钮（Enter/Space 可触发），点开只读详情（D13）。 */
export function RunHistory({
  runs,
  currentId,
  onOpen,
}: {
  runs: RunSummary[];
  currentId: string;
  onOpen: (run: RunSummary) => void;
}) {
  const past = runs.filter((r) => r.id !== currentId);
  if (!past.length) return null;
  return (
    <details className="zz-history" data-testid="workflow-history">
      <summary>{C.workflow.history(past.length)}</summary>
      <ul className="zz-history__list">
        {past.map((r) => (
          <li key={r.id} data-state={r.state}>
            <button
              type="button"
              data-testid="workflow-history-item"
              data-state={r.state}
              aria-label={`${kindLabel(r.kind)} · ${stateLabel(r.state)} · ${timeOf(r.created)} · ${C.workflow.open}`}
              // 行内复刻 zz-history__list li 的网格（按钮铺满整行；样式文件不在本卡清单内）。
              style={{
                display: "grid",
                gridColumn: "1 / -1",
                gridTemplateColumns: "minmax(0, 1fr) auto auto",
                alignItems: "center",
                gap: "var(--zz-space-2)",
                width: "100%",
                minHeight: 32,
                background: "none",
                border: "none",
                borderBottom: "1px solid var(--zz-border)",
                padding: 0,
                font: "inherit",
                color: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
              onClick={() => onOpen(r)}
            >
              <span className="zz-history__kind">{kindLabel(r.kind)}</span>
              <StatusChip tone={stateTone(r.state)} label={stateLabel(r.state)} />
              <span className="zz-history__time">{timeOf(r.created)}</span>
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}
