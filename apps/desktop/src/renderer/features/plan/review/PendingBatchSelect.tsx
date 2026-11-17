import React from "react";
import type { PendingSource } from "@zhizhang/fanqie/bible";
import { P } from "../shared";

export function PendingBatchSelect({
  batch,
  rows,
  onSelect,
}: {
  batch: string;
  rows?: Array<{ id: string; source: PendingSource; created: string; items: number }>;
  onSelect: (batch: string) => void;
}) {
  return (
    <label>
      {P["plan.batch"]}
      <select
        data-testid="pending-batch"
        value={batch}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">{P["plan.none"]}</option>
        {rows?.map((row) => (
          <option key={row.id} value={row.id}>
            {P[`plan.origin.${row.source}`]} · {row.created} · {row.items}
          </option>
        ))}
      </select>
    </label>
  );
}
