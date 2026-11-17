import React, { useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import type { AnyOp, PendingItem } from "@zhizhang/fanqie/bible";
import { desktop } from "../../../state/desktop";
import { P } from "../shared";
export function DivergenceChoice({
  work,
  batch,
  item,
  readonly,
  done,
}: {
  work: string;
  batch: string;
  item: PendingItem;
  readonly: boolean;
  done(): void;
}) {
  const [error, setError] = useState("");
  const choose = async (choice: "replace" | "keep" | "reject") => {
    if (item.op.type !== "state.add") return;
    try {
      const incoming = item.op.entry;
      let edited: AnyOp = { type: "state.add", entry: { ...incoming, mode: "add" } };
      if (choice === "replace") {
        const bible = await desktop.workbench("fanqie.bible.get", { work });
        const planned = bible.states.find(
          (state) =>
            state.status === "planned" &&
            state.entity === incoming.entity &&
            state.facet === incoming.facet &&
            state.field === incoming.field &&
            state.target === incoming.target &&
            state.since === incoming.since,
        );
        if (!planned) {
          setError(P["plan.stale"]);
          return;
        }
        edited = {
          type: "state.update",
          id: planned.id,
          expectedRev: planned.rev,
          patch: { value: incoming.value, status: "confirmed", evidence: incoming.evidence },
        };
      }
      await desktop.workbench("fanqie.pending.decide", {
        work,
        batch,
        decisions: [
          {
            id: item.id,
            decision: choice === "reject" ? "reject" : "edit",
            ...(choice === "reject" ? {} : { edited }),
          },
        ],
      });
      done();
    } catch (error) {
      setError(String(error));
    }
  };
  return (
    <div className="zz-plan-card">
      <Button disabled={readonly} onClick={() => void choose("replace")}>
        {P["plan.factReplace"]}
      </Button>
      <Button disabled={readonly} onClick={() => void choose("keep")}>
        {P["plan.factKeepBoth"]}
      </Button>
      <Button disabled={readonly} onClick={() => void choose("reject")}>
        {P["plan.factReject"]}
      </Button>
      <p role="alert">{error}</p>
    </div>
  );
}
