import React, { useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import type { AuditFinding } from "@zhizhang/fanqie/bible";
import { desktop } from "../../../state/desktop";
import { desktopStore } from "../../../state/store";
import { P, TextField } from "../shared";
export function ChecksPage({ work }: { work: string }) {
  const [upTo, setUpTo] = useState("1"),
    [findings, setFindings] = useState<AuditFinding[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section data-testid="checks-page">
      <div className="zz-plan-toolbar">
        <TextField label={P["plan.asOf"]} value={upTo} onChange={setUpTo} />
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError("");
            void desktop
              .workbench("fanqie.check.run", { work, upTo: Number(upTo) })
              .then(setFindings)
              .catch((error: unknown) => setError(String(error)))
              .finally(() => setBusy(false));
          }}
        >
          {P["plan.runChecks"]}
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {findings.map((finding, index) => (
        <div key={index} className="zz-plan-card">
          <h3>{finding.title}</h3>
          <p>{finding.detail}</p>
          <Button
            onClick={() =>
              desktopStore.set({
                planTab:
                  finding.jump.view === "entity" || finding.jump.view === "thread"
                    ? "library"
                    : "outline",
                planFocus: finding.jump.id,
              })
            }
          >
            {P["plan.openPlan"]}
          </Button>
        </div>
      ))}
    </section>
  );
}
