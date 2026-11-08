import React, { useState } from "react";
import { COPY as copy, WORKFLOW_COPY } from "../../../../../../packages/ui/src/copy.js";
import { isRecord } from "../../../../../../packages/core/src/parse.js";
import type { WorkflowRecord } from "../../../../../../packages/core/src/workflow-config.js";
import "../../../styles/workflow-stages.css";

function completedDrafts(record: WorkflowRecord) {
  return record.steps.flatMap((step) =>
    /^draft-\d+$/.test(step.id) &&
    step.status === "complete" &&
    isRecord(step.output) &&
    typeof step.output.title === "string" &&
    typeof step.output.body === "string"
      ? [{ title: step.output.title, body: step.output.body }]
      : [],
  );
}

/** 多稿并排对照；窄面板里上下排列，加宽后左右排列。 */
export function DraftCompare({ record }: { record: WorkflowRecord }) {
  const [choice, setChoice] = useState<[number, number]>([0, 1]);
  const drafts = completedDrafts(record);
  if (drafts.length < 2) return null;
  return (
    <details className="wf-compare">
      <summary>
        {copy.workflowCompare} · {drafts.length}
      </summary>
      <div className="wf-compare-grid">
        {choice.map((index, column) => {
          return (
            <section key={column}>
              <select
                aria-label={copy.workflowCompare + " " + (column + 1)}
                value={index}
                onChange={(event) => {
                  const next: [number, number] = [...choice];
                  next[column] = Number(event.target.value);
                  setChoice(next);
                }}
              >
                {drafts.map((draft, option) => (
                  <option key={option} value={option}>
                    {WORKFLOW_COPY.draftNumber(option)} · {draft.title}
                  </option>
                ))}
              </select>
              <div className="wf-compare-text">{drafts[index].body}</div>
            </section>
          );
        })}
      </div>
    </details>
  );
}
