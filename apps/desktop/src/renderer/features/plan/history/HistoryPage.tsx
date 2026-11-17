import React, { useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { desktop } from "../../../state/desktop";
import { askConfirm } from "../../../state/confirm";
import { P, ResourceState, usePlanResource } from "../shared";
export function HistoryPage({ work, readonly }: { work: string; readonly: boolean }) {
  const [message, setMessage] = useState(""),
    [source, setSource] = useState<
      "author" | "plan" | "import" | "ledger" | "assistant" | undefined
    >();
  const data = usePlanResource(
    () => desktop.workbench("fanqie.bible.changes", { work, limit: 100, source }),
    work,
    false,
    source,
  );
  return (
    <section data-testid="history-page">
      <ResourceState loading={data.loading} error={data.error} retry={data.refresh} />
      <label>
        {P["plan.source"]}
        <select
          value={source ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            setSource(
              value === "author" ||
                value === "plan" ||
                value === "import" ||
                value === "ledger" ||
                value === "assistant"
                ? value
                : undefined,
            );
          }}
        >
          <option value="">{P["plan.all"]}</option>
          {["author", "plan", "import", "ledger", "assistant"].map((source) => (
            <option key={source} value={source}>
              {source === "author" ||
              source === "plan" ||
              source === "import" ||
              source === "ledger" ||
              source === "assistant"
                ? P[`plan.origin.${source}`]
                : source}
            </option>
          ))}
        </select>
      </label>
      <p role="status">{message}</p>
      {data.value?.changes.map((change) => (
        <div key={change.id} className="zz-plan-card">
          <h3>{change.summary}</h3>
          <p>
            {change.at} · {P[`plan.origin.${change.source}`]}
          </p>
          <Button
            disabled={readonly}
            onClick={() =>
              void askConfirm(P["plan.revertConfirm"])
                .then(async (ok) => {
                  if (!ok) return;
                  const result = await desktop.workbench("fanqie.bible.revert", {
                    work,
                    changeId: change.id,
                  });
                  setMessage(
                    result.skipped.length
                      ? `${P["plan.skipped"]} ${result.skipped.map((row) => row.target).join(", ")}`
                      : P["plan.updated"],
                  );
                  data.refresh();
                })
                .catch((error: unknown) => setMessage(String(error)))
            }
          >
            {P["plan.revert"]}
          </Button>
        </div>
      ))}
    </section>
  );
}
