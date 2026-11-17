import React, { useState } from "react";
import { Button } from "@zhizhang/ui/primitives";
import type { PendingItem } from "@zhizhang/fanqie/bible";
import { desktop } from "../../../state/desktop";
import { P, usePlanResource } from "../shared";
export function ResolveChoice({
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
  const data = usePlanResource(() => desktop.workbench("fanqie.bible.get", { work }), work);
  const candidates = new Set(
    item.notes
      .filter((note) => note.startsWith("import.candidate:"))
      .map((note) => note.slice("import.candidate:".length)),
  );
  return (
    <div className="zz-plan-card">
      <p>{P["plan.matchCandidate"]}</p>
      {data.value?.entities
        .filter((entity) => candidates.has(entity.id))
        .map((entity) => (
          <div key={entity.id}>
            <strong>{entity.name}</strong>
            <p>{entity.summary}</p>
            <Button
              disabled={readonly}
              onClick={() => {
                if (item.op.type !== "entity.upsert") return;
                const incoming = item.op.entity;
                void desktop
                  .workbench("fanqie.pending.decide", {
                    work,
                    batch,
                    decisions: [
                      {
                        id: item.id,
                        decision: "edit",
                        edited: {
                          type: "entity.upsert",
                          expectedRev: entity.rev,
                          entity: {
                            ...entity,
                            aliases: [
                              ...new Set([...entity.aliases, incoming.name, ...incoming.aliases]),
                            ].filter((name) => name !== entity.name),
                            summary: entity.summary || incoming.summary,
                            attributes: { ...incoming.attributes, ...entity.attributes },
                          },
                        },
                      },
                    ],
                  })
                  .then(done)
                  .catch((error) => setError(String(error)));
              }}
            >
              {P["plan.linkCandidate"]}
            </Button>
          </div>
        ))}
      <p role="alert">{error}</p>
    </div>
  );
}
